// MIND AI Service Integration
import { createMindsClient } from "@animocabrands/minds-client-lib";

const MIND_API_KEY = import.meta.env.VITE_MIND_API_KEY;

let clientInstance = null;
let defaultMindId = null;

export const getMindsClient = () => {
  if (!MIND_API_KEY) {
    console.warn("No MIND API KEY provided!");
    return null;
  }
  
  if (!clientInstance) {
    clientInstance = createMindsClient({ builderApiKey: MIND_API_KEY });
  }
  return clientInstance;
};

export const initializeChat = async (alias = "main") => {
  const client = getMindsClient();
  if (!client) return { error: "No API Key configured" };

  try {
    if (!defaultMindId) {
      let humanId = null;
      try {
        if (MIND_API_KEY) {
          const payloadBase64 = MIND_API_KEY.split('.')[1];
          const payload = JSON.parse(atob(payloadBase64));
          humanId = payload.humanId;
        }
      } catch (e) {
        console.error("Failed to parse humanId from MIND_API_KEY", e);
      }

      const minds = await client.listMinds({ humanId });
      if (minds.length === 0) {
        return { error: "No Minds on this account" };
      }
      defaultMindId = minds[0]?.mindId;
    }
    
    await client.ensureConversation(alias, defaultMindId);
    
    // Fetch initial history
    const history = await client.getHistory(alias, { limit: 50 });
    return { success: true, history };
  } catch (err) {
    console.error("Failed to initialize chat:", err);
    return { error: err.message };
  }
};

export const sendChatMessage = async (messageText, alias = "main") => {
  const client = getMindsClient();
  if (!client) return null;
  
  try {
    const before = await client.getLatestHistoryFingerprint(alias);
    
    await client.sendMessage({ alias, messageText });
    
    const outcome = await client.waitForReply({
      alias,
      timeoutMs: 120_000,
      afterFingerprint: before,
      sentMessageText: messageText,
    });
    
    if (!outcome.timedOut) {
      return outcome.reply;
    } else {
      return { messageText: "Request timed out while waiting for a reply.", isError: true };
    }
  } catch (err) {
    console.error("Failed to send message:", err);
    return { messageText: "Failed to send message: " + err.message, isError: true };
  }
};
