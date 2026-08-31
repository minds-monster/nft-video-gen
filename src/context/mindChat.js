import { createContext, useContext } from 'react';

// Kept out of the provider's .jsx file so that file only exports a component
// (React Fast Refresh requirement).
export const MindChatContext = createContext(null);

export const useMindChatContext = () => {
  const chat = useContext(MindChatContext);
  if (!chat) throw new Error('useMindChatContext must be used inside <MindChatProvider>');
  return chat;
};
