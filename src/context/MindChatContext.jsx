import { useMindConnect } from '../hooks/useMindConnect';
import { useMindChat } from '../hooks/useMindChat';
import { MindChatContext } from './mindChat';

// One connection, one conversation, shared by the header button, the Producer panel,
// and the Studio overlay — connecting once switches all three to the visitor's own Mind.
const MindChatProvider = ({ children }) => {
  const connect = useMindConnect();
  const chat = useMindChat(connect.session);
  // Both hooks return a field called `error` for two different things (why the connect
  // attempt failed vs. why the last chat send failed) — spreading both flat would let
  // chat's silently win. `error` stays chat's, matching its existing use in
  // ProducerPanel/StudioOverlay; connect's gets its own name so nothing is lost.
  return (
    <MindChatContext.Provider value={{ ...connect, ...chat, connectError: connect.error }}>
      {children}
    </MindChatContext.Provider>
  );
};

export default MindChatProvider;
