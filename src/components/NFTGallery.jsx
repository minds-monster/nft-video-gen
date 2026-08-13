import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { getNFTsForContract } from '../services/alchemy';

const NFTGallery = () => {
  const [nfts, setNfts] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchAssets = async () => {
      // Example demo contract (Bored Ape Yacht Club, etc., or a generic one)
      const demoContract = "0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d"; 
      const assets = await getNFTsForContract(demoContract);
      setNfts(assets);
      setLoading(false);
    };
    fetchAssets();
  }, []);

  if (loading) {
    return (
      <div className="w-full h-48 flex items-center justify-center border-b border-white/10 bg-black/20">
        <div className="w-8 h-8 border-2 border-t-blue-500 rounded-full animate-spin"></div>
      </div>
    );
  }

  // Duplicate items to create a seamless infinite loop
  const displayNfts = [...nfts, ...nfts];

  return (
    <div className="w-full overflow-hidden bg-black/40 border-b border-white/5 py-8 relative">
      <div className="absolute inset-0 bg-gradient-to-r from-slate-950 via-transparent to-slate-950 z-10 pointer-events-none"></div>
      
      <motion.div 
        className="flex gap-6 whitespace-nowrap px-4"
        animate={{ x: [0, -1000] }}
        transition={{
          repeat: Infinity,
          repeatType: "loop",
          duration: 30,
          ease: "linear",
        }}
      >
        {displayNfts.map((nft, idx) => {
          const imageUrl = nft.media?.[0]?.gateway || nft.rawMetadata?.image;
          
          return (
            <motion.div 
              key={`${nft.tokenId}-${idx}`}
              whileHover={{ scale: 1.05, y: -5 }}
              className="relative shrink-0 w-40 h-40 md:w-52 md:h-52 rounded-2xl overflow-hidden glass-panel group cursor-pointer"
            >
              {imageUrl ? (
                <img 
                  src={imageUrl} 
                  alt={nft.title || `NFT ${nft.tokenId}`} 
                  className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                  onError={(e) => { e.target.src = 'https://picsum.photos/400/400' }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-slate-800 text-xs text-slate-400">
                  No Image
                </div>
              )}
              
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/0 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-4">
                <span className="text-white text-sm font-semibold truncate w-full text-center">
                  {nft.title || `Token #${nft.tokenId}`}
                </span>
              </div>
            </motion.div>
          )
        })}
      </motion.div>
    </div>
  );
};

export default NFTGallery;
