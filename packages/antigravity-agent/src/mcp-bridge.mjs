#!/usr/bin/env node
/**
 * MCP stdio bridge for @any-code/antigravity-agent.
 *
 * This script is spawned by the Go binary as an MCP server (stdio transport).
 * It reads tool definitions from ANYCODE_TOOLS_JSON env var and handles
 * tools/list + tools/call by forwarding to the parent process via TCP.
 *
 * Protocol: JSON-RPC 2.0 over stdio with Content-Length framing (MCP standard)
 *
 * Flow:
 *   1. Go binary spawns this script
 *   2. Binary sends initialize/tools/list/tools/call via stdin
 *   3. tools/list returns tool definitions from ANYCODE_TOOLS_JSON
 *   4. tools/call forwards to parent TCP server for execution
 *   5. Parent executes Tool.Info.execute() and returns result
 */
import { createConnection } from "node:net"

const TOOLS_JSON = process.env.ANYCODE_TOOLS_JSON || "[]"
const TCP_PORT = parseInt(process.env.ANYCODE_MCP_PORT || "0")
const DEBUG = process.env.ANYCODE_MCP_DEBUG === "1"

let tools = []
try {
  tools = JSON.parse(TOOLS_JSON)
} catch {}

function log(...args) {
  if (DEBUG) process.stderr.write(`[mcp-bridge] ${args.join(" ")}\n`)
}

log(`Started. ${tools.length} tools, TCP port ${TCP_PORT}`)

// --- Content-Length message framing ---

let buf = Buffer.alloc(0)
let expectedLength = -1

process.stdin.on("data", (chunk) => {
  buf = Buffer.concat([buf, typeof chunk === "string" ? Buffer.from(chunk) : chunk])
  processBuffer()
})

function processBuffer() {
  while (true) {
    if (expectedLength === -1) {
      // Look for Content-Length header
      const headerEnd = buf.indexOf("\r\n\r\n")
      if (headerEnd === -1) return // Incomplete header

      const header = buf.slice(0, headerEnd).toString("utf8")
      const match = header.match(/Content-Length:\s*(\d+)/i)
      if (!match) {
        // No Content-Length — try parsing as bare JSON line (fallback)
        const nlIdx = buf.indexOf("\n")
        if (nlIdx === -1) return
        const line = buf.slice(0, nlIdx).toString("utf8").trim()
        buf = buf.slice(nlIdx + 1)
        if (line) {
          try {
            handleMessage(JSON.parse(line))
          } catch {}
        }
        continue
      }

      expectedLength = parseInt(match[1])
      buf = buf.slice(headerEnd + 4) // Skip past \r\n\r\n
    }

    // Wait for enough data
    if (buf.length < expectedLength) return

    const body = buf.slice(0, expectedLength).toString("utf8")
    buf = buf.slice(expectedLength)
    expectedLength = -1

    try {
      const msg = JSON.parse(body)
      log(`← ${msg.method || "response"} id=${msg.id}`)
      handleMessage(msg)
    } catch (e) {
      log(`Parse error: ${e.message}, body: ${body.slice(0, 200)}`)
    }
  }
}

// --- Message sending ---

function send(obj) {
  const s = JSON.stringify(obj)
  const header = `Content-Length: ${Buffer.byteLength(s)}\r\n\r\n`
  process.stdout.write(header + s)
  log(`→ response id=${obj.id}`)
}

// --- Message handling ---

function handleMessage(msg) {
  if (msg.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "anycode-tools", version: "1.0.0" },
      },
    })
  } else if (msg.method === "notifications/initialized") {
    // Notification, no response needed
  } else if (msg.method === "tools/list") {
    const toolList = tools.map((t) => ({
      name: t.name,
      description: t.description || "",
      inputSchema: t.inputSchema || { type: "object", properties: {} },
    }))
    log(`tools/list → ${toolList.length} tools: ${toolList.map(t => t.name).join(", ")}`)
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: { tools: toolList },
    })
  } else if (msg.method === "tools/call") {
    const toolName = msg.params?.name
    const args = msg.params?.arguments || {}
    log(`tools/call → ${toolName}(${JSON.stringify(args).slice(0, 200)})`)

    if (TCP_PORT > 0) {
      // Forward to parent TCP server for execution
      const conn = createConnection(TCP_PORT, "127.0.0.1", () => {
        conn.write(
          JSON.stringify({ type: "tool_call", id: msg.id, toolName, args }) +
            "\n",
        )
      })
      let respBuf = ""
      conn.on("data", (chunk) => {
        respBuf += chunk.toString()
        let i
        while ((i = respBuf.indexOf("\n")) !== -1) {
          const line = respBuf.slice(0, i)
          respBuf = respBuf.slice(i + 1)
          try {
            const resp = JSON.parse(line)
            if (resp.error) {
              log(`tools/call error: ${resp.error}`)
              send({
                jsonrpc: "2.0",
                id: msg.id,
                result: {
                  content: [{ type: "text", text: resp.error }],
                  isError: true,
                },
              })
            } else {
              const output = resp.result?.output || ""
              log(`tools/call result: ${output.slice(0, 100)}`)
              send({
                jsonrpc: "2.0",
                id: msg.id,
                result: {
                  content: [{ type: "text", text: output }],
                },
              })
            }
          } catch {}
          conn.end()
        }
      })
      conn.on("error", (err) => {
        log(`TCP connection error: ${err.message}`)
        send({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            content: [{ type: "text", text: "MCP bridge connection error" }],
            isError: true,
          },
        })
      })
    } else {
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          content: [{ type: "text", text: `Tool ${toolName} not available (no bridge)` }],
          isError: true,
        },
      })
    }
  } else {
    log(`Unknown method: ${msg.method}`)
    if (msg.id !== undefined) {
      send({
        jsonrpc: "2.0",
        id: msg.id,
        error: { code: -32601, message: `Method not found: ${msg.method}` },
      })
    }
  }
}
