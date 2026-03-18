export default `Read the terminal output from the bottom of the buffer.

Returns the last N lines from the shared user terminal. Use this after sending a command via terminal_write to see its output.

## Parameters
- **length**: How many lines to read from the bottom. Start with a small number (e.g. 20-50) and increase if you need more context.
- **waitBefore**: Milliseconds to wait before reading. This is useful when a command needs time to finish:
  - Fast commands (ls, cat, echo): 500-1000ms
  - Build commands (npm run build): 5000-30000ms
  - Install commands (npm install): 10000-60000ms
  - If unsure, start with 2000ms and read again with more wait if output looks incomplete.

## Usage notes
- The terminal must exist (created via terminal_write type="create") before reading.
- If output looks truncated or the command hasn't finished, call terminal_read again with a longer waitBefore.
- Lines are returned as plain text, one per line.
`
