import { useMindConnect } from '../hooks/useMindConnect';
import { useMindChat } from '../hooks/useMindChat';
import { MindChatContext } from './mindChat';

// One connection, one conversation, shared by the header button, the Producer panel,
// and the Studio overlay — connecting once switches all three to the visitor's own Mind.
const MindChatProvider = ({ children }) => {
  const connect = useMindConnect();
  const chat = useMindChat(connect.session);
  return <MindChatContext.Provider value={{ ...connect, ...chat }}>{children}</MindChatContext.Provider>;
};

export default MindChatProvider;
