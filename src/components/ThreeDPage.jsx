import React, { useState, useEffect, Suspense, useRef } from 'react';
import { motion } from 'framer-motion';
import { ArrowDown, Search, ArrowRight, Loader2 } from 'lucide-react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stage } from '@react-three/drei';
import { parseContractInput } from '../lib/contractInput';
import { resolveTarget } from '../lib/contractResolve';
import { assetKey } from '../lib/assetKey';
import { useCastMesh } from './canvas/scene3d/useCastMesh';
import { resolveNftImage } from '../lib/nftMedia';
import nftsData from '../data/nfts.json';
import { fetchNft } from '../services/alchemy';

const ThreeDViewer = ({ currentAssetKey }) => {
  const meshState = useCastMesh(currentAssetKey, true);

  if (!meshState) return <div className="flex h-full items-center justify-center text-slate-400">Loading viewer...</div>;

  if (meshState.status === 'absent' || meshState.status === 'error') {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center">
        <p className="text-slate-300">No 3D model found for this asset.</p>
        <p className="mt-2 text-sm text-slate-500">{meshState.reason || 'Generate one first.'}</p>
      </div>
    );
  }

  if (meshState.status === 'pending') {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-purple-400" />
        <p className="mt-4 text-slate-300">Generating 3D model...</p>
        <p className="mt-2 text-sm text-slate-500">{meshState.progress}% complete</p>
      </div>
    );
  }

  if (meshState.status === 'unknown') {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8 text-center">
        <p className="text-slate-300">Unknown model state</p>
        <p className="mt-2 text-sm text-slate-500">{meshState.reason}</p>
      </div>
    );
  }

  return (
    <Canvas shadows camera={{ position: [0, 0, 4], fov: 50 }}>
      <Suspense fallback={null}>
        <Stage environment="city" intensity={0.5}>
          {meshState.scene && <primitive object={meshState.scene} />}
        </Stage>
      </Suspense>
      <OrbitControls makeDefault autoRotate />
    </Canvas>
  );
};

const DossierImage = ({ dossier }) => {
  const [imageUrl, setImageUrl] = useState(null);

  useEffect(() => {
    if (dossier.sourceUrl) {
      setImageUrl(dossier.sourceUrl);
      return;
    }
    if (dossier.sourceImageUrls?.[0]) {
      setImageUrl(dossier.sourceImageUrls[0]);
      return;
    }

    const loadFallback = async () => {
      // Fast fallback from static data
      const parts = dossier.key.split(':');
      if (parts.length >= 3) {
        const chain = parts[0];
        const address = parts[1];
        const tokenId = parts[2];

        // Search the nfts.json object
        // The key in nfts.json is like "chain:address:limit"
        // Let's iterate values to find the NFT if it exists
        for (const collection of Object.values(nftsData)) {
          const found = collection?.nfts?.find((n) => n.tokenId === String(tokenId) && n.contract?.address?.toLowerCase() === address.toLowerCase());
          if (found) {
            const img = resolveNftImage(found);
            if (img) {
              setImageUrl(img);
              return;
            }
          }
        }

        // Slow fallback from Alchemy
        const fetched = await fetchNft({ chain, address, tokenId });
        if (fetched) {
          const img = resolveNftImage(fetched);
          if (img) setImageUrl(img);
        }
      }
    };

    loadFallback();
  }, [dossier]);

  if (!imageUrl) {
    return <div className="h-full w-full bg-slate-800 animate-pulse" />;
  }

  return <img src={imageUrl} alt={dossier.subject || 'NFT image'} className="h-full w-full object-cover transition-transform group-hover:scale-105" />;
};

const ThreeDPage = () => {
  const [inputUrl, setInputUrl] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState(null);
  
  const [dossiers, setDossiers] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [listComplete, setListComplete] = useState(false);
  
  const [selectedAsset, setSelectedAsset] = useState(null); // Will hold assetKey

  const fetchDossiers = async (cursor) => {
    setIsLoadingList(true);
    try {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      const response = await fetch(`/api/dossiers${query}`);
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      
      setDossiers((prev) => [...prev, ...(data.dossiers || [])]);
      setNextCursor(data.cursor);
      setListComplete(data.listComplete);
    } catch (err) {
      console.error('Failed to load dossiers:', err);
    } finally {
      setIsLoadingList(false);
    }
  };

  useEffect(() => {
    fetchDossiers();
  }, []);

  const handleGenerate = async (e) => {
    e.preventDefault();
    setGenerateError(null);
    if (!inputUrl.trim()) return;

    setIsGenerating(true);
    try {
      const resolved = await resolveTarget(inputUrl);
      if (!resolved.ok) {
        throw new Error(resolved.error || 'Failed to resolve contract address.');
      }
      if (!resolved.tokenId) {
        throw new Error('Please provide a specific Token ID or a direct link to an NFT.');
      }

      const key = assetKey(resolved.chain, resolved.address, resolved.tokenId);
      
      const response = await fetch('/api/cast/mesh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset: key })
      });
      
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      
      // Generation queued. Open modal with this asset key!
      setSelectedAsset(key);
      setInputUrl('');
    } catch (err) {
      setGenerateError(err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 font-sans text-slate-50 pt-24 pb-20">
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] h-[60%] w-[60%] rounded-full bg-purple-600/10 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] h-[50%] w-[50%] rounded-full bg-blue-600/10 blur-[120px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-7xl px-6">
        {/* Hero Section */}
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-auto max-w-3xl text-center"
        >
          <span className="chip inline-flex items-center gap-2 px-4 py-1.5 text-xs font-medium text-purple-300">
            <span className="h-1.5 w-1.5 rounded-full bg-purple-400" />
            3D Generation
          </span>
          <h1 className="headline-monster mt-6 text-4xl md:text-6xl text-white">
            Convert any NFT to <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-blue-400">3D</span>
          </h1>
          <p className="mt-4 text-lg text-slate-400">
            Paste an OpenSea link or contract address with a token ID to generate a high-fidelity 3D mesh.
          </p>

          <form onSubmit={handleGenerate} className="mt-10 max-w-xl mx-auto">
            <div className="relative flex items-center group">
              <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none text-slate-500 group-focus-within:text-purple-400 transition-colors">
                <Search className="w-5 h-5" />
              </div>
              <input
                type="text"
                className="w-full bg-slate-900/50 border border-slate-700/50 rounded-2xl py-4 pl-12 pr-32 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 transition-all placeholder-slate-600"
                placeholder="Paste NFT URL or 0x.../id"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
              />
              <button
                type="submit"
                disabled={isGenerating || !inputUrl.trim()}
                className="absolute right-2 top-2 bottom-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 rounded-xl font-medium transition-colors flex items-center gap-2"
              >
                {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Generate'}
              </button>
            </div>
            {generateError && (
              <p className="mt-3 text-sm text-rose-400 text-left px-2">{generateError}</p>
            )}
          </form>
        </motion.div>

        {/* Existing Meshes List */}
        <div className="mt-24">
          <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-8">
            <h2 className="text-2xl font-semibold">Gallery</h2>
            <span className="text-sm text-slate-500">Previously generated dossiers</span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {dossiers.map((dossier) => (
              <div 
                key={dossier.key}
                onClick={() => setSelectedAsset(dossier.key)}
                className="group relative aspect-square bg-slate-900 rounded-2xl overflow-hidden cursor-pointer border border-white/5 hover:border-purple-500/30 transition-all shadow-lg hover:shadow-purple-500/10"
              >
                <DossierImage dossier={dossier} />
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-900/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-4">
                  <p className="text-xs font-medium text-white truncate">{dossier.subject || 'NFT'}</p>
                  <p className="text-[10px] text-slate-400 uppercase tracking-wider mt-1 truncate">{dossier.key.split(':').slice(0, 2).join(':')}</p>
                </div>
                <div className="absolute top-2 right-2 bg-slate-950/60 backdrop-blur-md rounded-full p-1.5 opacity-0 group-hover:opacity-100 transition-opacity -translate-y-2 group-hover:translate-y-0 text-white">
                  <ArrowRight className="w-3 h-3" />
                </div>
              </div>
            ))}
          </div>

          {isLoadingList && (
            <div className="py-12 flex justify-center">
              <Loader2 className="w-6 h-6 animate-spin text-slate-500" />
            </div>
          )}

          {!isLoadingList && !listComplete && dossiers.length > 0 && (
            <div className="mt-12 flex justify-center">
              <button 
                onClick={() => fetchDossiers(nextCursor)}
                className="chip px-6 py-2.5 text-sm font-medium text-slate-300 hover:text-white"
              >
                Load More
              </button>
            </div>
          )}
          
          {!isLoadingList && dossiers.length === 0 && (
            <div className="py-20 text-center text-slate-500">
              No generated 3D meshes found yet.
            </div>
          )}
        </div>
      </div>

      {/* 3D Viewer Modal */}
      {selectedAsset && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="relative w-full max-w-4xl bg-slate-900 border border-white/10 rounded-3xl overflow-hidden shadow-2xl flex flex-col h-[80vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-slate-900/50">
              <h3 className="text-sm font-semibold truncate max-w-lg">{selectedAsset}</h3>
              <button 
                onClick={() => setSelectedAsset(null)}
                className="text-xs font-medium uppercase tracking-wider text-slate-400 hover:text-white transition-colors"
              >
                Close
              </button>
            </div>
            <div className="flex-1 relative bg-gradient-to-b from-slate-900 to-slate-950">
              <ThreeDViewer currentAssetKey={selectedAsset} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ThreeDPage;
