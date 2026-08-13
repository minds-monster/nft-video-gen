import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { initializeChat, sendChatMessage } from '../services/mind';
import { Sparkles, Send, Loader2, MessageSquare, AlertCircle } from 'lucide-react';

const ChatInterface = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [error, setError] = useState(null);
  
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    const setupChat = async () => {
      setIsInitializing(true);
      setError(null);
      const res = await initializeChat();
      if (res.error) {
        setError(res.error);
      } else if (res.history) {
        setMessages(res.history);
      }
      setIsInitializing(false);
    };
    setupChat();
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, isSending]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!input.trim() || isSending) return;

    const userText = input.trim();
    setInput('');
    
    // Optimistically add user message
    const tempUserMessage = {
      fingerprint: Date.now().toString(),
      senderType: 1, // 1 = human
      messageText: userText,
      createdAt: new Date().toISOString()
    };
    
    setMessages(prev => [...prev, tempUserMessage]);
    setIsSending(true);

    const reply = await sendChatMessage(userText);
    
    if (reply) {
      setMessages(prev => [...prev, reply]);
    }
    
    setIsSending(false);
  };

  return (
    <div className="w-full max-w-4xl mx-auto flex flex-col items-center justify-center p-6 mt-12 mb-24 z-20">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-8"
      >
        <h1 className="text-4xl md:text-5xl font-extrabold mb-4 text-gradient drop-shadow-sm">
          Chat with MIND AI
        </h1>
        <p className="text-slate-400 text-lg max-w-2xl mx-auto">
          Discuss your NFTs, generate new ideas, and orchestrate actions through conversation.
        </p>
      </motion.div>

      {/* Chat History Area */}
      <div className="w-full h-[500px] glass-panel rounded-3xl p-6 mb-6 flex flex-col relative overflow-hidden shadow-2xl ring-1 ring-white/10">
        
        {isInitializing ? (
          <div className="flex-1 flex flex-col items-center justify-center space-y-4">
            <Loader2 className="w-10 h-10 animate-spin text-purple-500" />
            <p className="text-slate-400">Initializing conversation...</p>
          </div>
        ) : error ? (
          <div className="flex-1 flex flex-col items-center justify-center space-y-4 text-red-400">
            <AlertCircle className="w-12 h-12" />
            <p className="text-lg">{error}</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto pr-4 space-y-6 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 space-y-4">
                <MessageSquare className="w-16 h-16 opacity-50" />
                <p>No messages yet. Say hello!</p>
              </div>
            ) : (
              messages.map((msg, idx) => {
                const isHuman = msg.senderType === 1;
                return (
                  <motion.div 
                    key={msg.fingerprint || idx}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`flex flex-col ${isHuman ? 'items-end' : 'items-start'}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                        {isHuman ? 'You' : 'Mind AI'}
                      </span>
                    </div>
                    <div 
                      className={`max-w-[80%] rounded-2xl px-5 py-3 ${
                        isHuman 
                          ? 'bg-gradient-to-br from-blue-600 to-purple-600 text-white shadow-lg shadow-purple-500/20 rounded-tr-sm' 
                          : 'bg-white/5 border border-white/10 text-slate-200 rounded-tl-sm'
                      } ${msg.isError ? 'border-red-500/50 bg-red-500/10' : ''}`}
                    >
                      <p className="whitespace-pre-wrap leading-relaxed">{msg.messageText}</p>
                      
                      {/* Render attachments/artifacts if they exist */}
                      {msg.artifact && msg.mimeType?.startsWith('video/') && (
                        <div className="mt-4 rounded-xl overflow-hidden bg-black/50 border border-white/10">
                          <video 
                            src={msg.artifactUrl || msg.url || (typeof msg.artifact === 'string' ? msg.artifact : '')} 
                            controls
                            autoPlay
                            loop
                            muted
                            className="w-full h-full object-cover"
                          />
                        </div>
                      )}
                    </div>
                  </motion.div>
                );
              })
            )}
            
            {isSending && (
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-start"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                    Mind AI
                  </span>
                </div>
                <div className="bg-white/5 border border-white/10 text-slate-200 rounded-2xl rounded-tl-sm px-5 py-4 flex items-center gap-3">
                  <div className="flex space-x-1">
                    <div className="w-2 h-2 rounded-full bg-purple-500 animate-bounce" style={{ animationDelay: '0ms' }}></div>
                    <div className="w-2 h-2 rounded-full bg-purple-500 animate-bounce" style={{ animationDelay: '150ms' }}></div>
                    <div className="w-2 h-2 rounded-full bg-purple-500 animate-bounce" style={{ animationDelay: '300ms' }}></div>
                  </div>
                </div>
              </motion.div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <motion.form 
        onSubmit={handleSubmit}
        className="w-full relative group"
        whileHover={{ scale: 1.01 }}
        transition={{ type: "spring", stiffness: 400, damping: 25 }}
      >
        <div className="absolute -inset-1 bg-gradient-to-r from-blue-500 to-purple-600 rounded-2xl blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200"></div>
        <div className="relative glass-panel rounded-2xl flex items-center p-2">
          <div className="p-3 text-purple-400">
            <Sparkles className="w-6 h-6" />
          </div>
          <input 
            type="text" 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Send a message to Mind AI..."
            className="flex-1 bg-transparent border-none outline-none text-white placeholder-slate-500 text-lg px-2 py-3"
            disabled={isSending || isInitializing}
          />
          <button 
            type="submit" 
            disabled={isSending || isInitializing || !input.trim()}
            className="bg-purple-600 hover:bg-purple-500 disabled:bg-purple-600/50 text-white p-3 rounded-xl transition-colors flex items-center justify-center shadow-lg"
          >
            {isSending ? <Loader2 className="w-6 h-6 animate-spin" /> : <Send className="w-6 h-6" />}
          </button>
        </div>
      </motion.form>
    </div>
  );
};

export default ChatInterface;
