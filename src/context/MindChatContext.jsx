import { useMindChat } from '../hooks/useMindChat';
import { MindChatContext } from './mindChat';

// One conversation, shared by the hero prompt bar and the Studio. mind.js keeps a
// single conversation alias, so the UI should mirror that rather than pretending
// each surface has its own thread.
const MindChatProvider = ({ children }) => {
  const chat = useMindChat();
  return <MindChatContext.Provider value={chat}>{children}</MindChatContext.Provider>;
};

export default MindChatProvider;
