import React from 'react';
import NFTGallery from './components/NFTGallery';
import ChatInterface from './components/ChatInterface';
import { BrainCircuit } from 'lucide-react';

function App() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-50 relative flex flex-col font-sans">
      
      {/* Background elements */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-purple-600/20 blur-[120px]"></div>
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-blue-600/20 blur-[120px]"></div>
      </div>

      {/* Header */}
      <header className="relative z-20 border-b border-white/10 bg-slate-950/50 backdrop-blur-md sticky top-0">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-br from-purple-500 to-blue-600 rounded-xl shadow-lg shadow-purple-500/20">
              <BrainCircuit className="w-6 h-6 text-white" />
            </div>
            <span className="text-xl font-bold tracking-tight">MindForge</span>
          </div>
          
          <nav className="hidden md:flex gap-8 text-sm font-medium text-slate-400">
            <a href="#" className="hover:text-white transition-colors">Gallery</a>
            <a href="#" className="hover:text-white transition-colors">Studio</a>
            <a href="#" className="hover:text-white transition-colors">Documentation</a>
          </nav>
          
          <button className="bg-white/10 hover:bg-white/20 border border-white/10 rounded-full px-5 py-2 text-sm font-semibold transition-all shadow-[0_0_15px_rgba(255,255,255,0.05)] hover:shadow-[0_0_20px_rgba(255,255,255,0.1)]">
            Connect Wallet
          </button>
        </div>
      </header>

      {/* Main Layout */}
      <main className="flex-1 flex flex-col relative z-10">
        
        {/* Top anchored moving NFT gallery */}
        <section className="w-full">
          <NFTGallery />
        </section>

        {/* Center/Bottom Video Generator / Chat UI */}
        <section className="flex-1 flex flex-col justify-center items-center px-4 md:px-0">
          <ChatInterface />
        </section>
        
      </main>
      
      {/* Footer */}
      <footer className="relative z-20 border-t border-white/10 py-8 mt-auto text-center text-slate-500 text-sm">
        <p>Powered by <span className="text-purple-400">Hellominds</span> & <span className="text-blue-400">Alchemy</span></p>
      </footer>
    </div>
  );
}

export default App;
