/**
 * Antigravity LLM Request Pattern Reference
 * 
 * Documents the communication patterns used by Antigravity.app
 * when interacting with Google's internal LLM APIs.
 * 
 * Key findings:
 * 
 * 1. LOCAL LANGUAGE SERVER (ConnectRPC)
 *    - Port: random (discover via `ps aux | grep language_server_macos`)
 *    - CSRF Header: x-codeium-csrf-token
 *    - Service: exa.language_server_pb.LanguageServerService
 *    
 *    Key RPCs:
 *    - GetAllCascadeTrajectories: List all conversations
 *    - GetCascadeTrajectorySteps: Get steps for a conversation
 *    - SendUserCascadeMessage: Send user input (HTTP/2, application/json)
 *    - StartCascade: Create new conversation
 *    - GetCascadeModelConfigData: Get available models
 *    - SendActionToChatPanel: Focus a cascade (unary, only cascadeId)
 *    - SendAllQueuedMessages: Flush queued messages
 * 
 * 2. GOOGLE INTERNAL API (REST/gRPC)
 *    - Endpoint: cloudcode-pa.googleapis.com/v1internal
 *    - Alt endpoint: daily-cloudcode-pa.googleapis.com
 *    - Auth: Google OAuth2 (hardcoded client ID/secret in AntigravityManager)
 *    - Methods: loadCodeAssist, fetchAvailableModels, onboardUser
 *    
 *    Go binary uses gRPC to:
 *    - google.internal.cloud.code.v1internal.PredictionService/GenerateContent
 *    - google.internal.cloud.code.v1internal.CloudCode/FetchAvailableModels
 *    - google.internal.cloud.code.v1internal.CloudCode/OnboardUser
 *    - google.internal.cloud.code.v1internal.CloudCode/ListModelConfigs
 *
 * 3. DISCOVERY
 *    - Process args contain: --csrf_token, --server_port, --extension_server_port
 *    - Discovery file format: { pid, httpsPort, httpPort, lspPort, lsVersion, csrfToken }
 *    - Extension server has its own CSRF token (--extension_server_csrf_token)
 * 
 * 4. MODELS (as of March 2026)
 *    - Gemini 3.1 Pro (High) — MODEL_PLACEHOLDER_M37
 *    - Supports images, audio (webm/opus), PDF, code files
 *    - Quota resets periodically, remainingFraction tracked per model
 */

// ---- Example: List cascades ----
async function listCascades(server) {
  const res = await fetch(
    `https://127.0.0.1:${server.port}/exa.language_server_pb.LanguageServerService/GetAllCascadeTrajectories`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-codeium-csrf-token': server.csrfToken,
      },
      body: JSON.stringify({}),
    }
  );
  const data = await res.json();
  return data.trajectorySummaries || {};
}

// ---- Example: Send message (from WebAgentClient in main.js) ----
async function sendMessage(server, cascadeId, text, cascadeConfig) {
  const body = {
    cascadeId,
    items: [{ text }],
  };
  if (cascadeConfig) {
    body.cascadeConfig = cascadeConfig;
  }
  
  // This is a streaming RPC, needs HTTP/2
  const res = await fetch(
    `https://127.0.0.1:${server.port}/exa.language_server_pb.LanguageServerService/SendUserCascadeMessage`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-codeium-csrf-token': server.csrfToken,
      },
      body: JSON.stringify(body),
    }
  );
  return res;
}

// ---- Example: CascadeConfig structure (from WebAgentClient.serializeCascadeConfig) ----
function buildCascadeConfig(model = 'MODEL_PLACEHOLDER_M37') {
  return {
    plannerConfig: {
      planModel: 1008,
      requestedModel: { model },
      conversational: { agenticMode: true },
      toolConfig: {
        runCommand: {
          autoCommandConfig: {
            autoExecutionPolicy: 'AUTO_EXECUTION_POLICY_UNSPECIFIED'
          }
        },
        notifyUser: {
          artifactReviewMode: 'ARTIFACT_REVIEW_MODE_UNSPECIFIED'
        }
      },
      maxOutputTokens: 8192,
    },
    checkpointConfig: {
      maxOutputTokens: 8192,
    },
  };
}

console.log('This is a reference file. See ag-client.mjs for the working client.');
