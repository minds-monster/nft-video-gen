import React, { useState, useEffect, Suspense, useRef } from 'react';
import { motion } from 'framer-motion';
import { ArrowDown, Search, ArrowRight, Loader2, Database, Sparkles, X } from 'lucide-react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Environment, Center } from '@react-three/drei';
import { parseContractInput } from '../lib/contractInput';
import { resolveTarget } from '../lib/contractResolve';
import { assetKey } from '../lib/assetKey';
import { useCastMesh } from './canvas/scene3d/useCastMesh';
import { resolveNftImage } from '../lib/nftMedia';
import nftsData from '../data/nfts.json';
import { fetchNft } from '../services/alchemy';
const ThreeDViewer = ({ currentAssetKey, dossier, isGenerating, generateStatus }) => {
  const meshState = useCastMesh(currentAssetKey, !isGenerating);

  const renderSourceImageOverlay = (content) => (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-slate-950">
       {/* Tech Grid Background */}
       <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:40px_40px] opacity-20" />
       <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,#020617_100%)]" />
       
       <div className="relative z-10 max-w-md w-full p-8 flex flex-col items-center">
         {/* 3D Hologram Effect */}
         <div className="relative w-64 h-64 mb-8 flex items-center justify-center" style={{ perspective: '1000px' }}>
           {/* Scanning Rings */}
           <motion.div 
             animate={{ rotateX: [60, 60], rotateZ: [0, 360] }}
             transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
             className="absolute inset-0 rounded-full border border-purple-500/30" 
             style={{ transformStyle: 'preserve-3d' }}
           />
           <motion.div 
             animate={{ rotateX: [70, 70], rotateY: [0, 360], rotateZ: [0, -360] }}
             transition={{ duration: 12, repeat: Infinity, ease: "linear" }}
             className="absolute inset-4 rounded-full border border-blue-500/30" 
             style={{ transformStyle: 'preserve-3d' }}
           />
           <motion.div 
             animate={{ rotateX: [80, 80], rotateZ: [0, 360] }}
             transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
             className="absolute inset-8 rounded-full border border-fuchsia-500/20 border-t-fuchsia-500/60" 
             style={{ transformStyle: 'preserve-3d' }}
           />
           
           {/* Core Cube */}
           <motion.div 
             animate={{ rotateX: 360, rotateY: 360 }}
             transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
             className="relative w-20 h-20"
             style={{ transformStyle: 'preserve-3d' }}
           >
             {[
               { transform: 'translateZ(40px)', color: 'border-purple-500/50 bg-purple-500/10' },
               { transform: 'rotateY(180deg) translateZ(40px)', color: 'border-purple-500/50 bg-purple-500/10' },
               { transform: 'rotateY(90deg) translateZ(40px)', color: 'border-blue-500/50 bg-blue-500/10' },
               { transform: 'rotateY(-90deg) translateZ(40px)', color: 'border-blue-500/50 bg-blue-500/10' },
               { transform: 'rotateX(90deg) translateZ(40px)', color: 'border-fuchsia-500/50 bg-fuchsia-500/10' },
               { transform: 'rotateX(-90deg) translateZ(40px)', color: 'border-fuchsia-500/50 bg-fuchsia-500/10' },
             ].map((face, i) => (
               <div 
                 key={i}
                 className={`absolute inset-0 border-2 backdrop-blur-sm flex items-center justify-center shadow-[0_0_15px_rgba(168,85,247,0.2)] ${face.color}`}
                 style={{ transform: face.transform }}
               >
                 {i === 0 && <Database className="w-6 h-6 text-purple-300/50" />}
               </div>
             ))}
           </motion.div>
         </div>

         {/* Content Wrapper */}
         <div className="relative z-20 backdrop-blur-md bg-slate-900/40 p-6 rounded-2xl border border-white/5 shadow-2xl w-full text-center">
           {content}
         </div>
       </div>
    </div>
  );

  if (isGenerating) {
    return renderSourceImageOverlay(
      <div className="text-center">
        <Loader2 className="h-10 w-10 animate-spin text-purple-400 mx-auto" />
        <p className="mt-6 text-slate-200 text-lg font-semibold">Generating 3D model...</p>
        {generateStatus && (
          <p className="mt-2 text-sm text-purple-300 font-mono bg-purple-500/10 px-3 py-1 rounded-full inline-block">
            {generateStatus}
          </p>
        )}
      </div>
    );
  }

  if (!meshState) return renderSourceImageOverlay(
    <div className="text-slate-400">Loading viewer...</div>
  );

  if (meshState.status === 'absent' || meshState.status === 'error') {
    return renderSourceImageOverlay(
      <div className="text-center">
        <p className="text-slate-200 text-lg font-semibold">No 3D model found</p>
        <p className="mt-2 text-sm text-slate-400">{meshState.reason || 'Generate one first.'}</p>
      </div>
    );
  }

  if (meshState.status === 'pending') {
    return renderSourceImageOverlay(
      <div className="text-center">
        <Loader2 className="h-10 w-10 animate-spin text-purple-400 mx-auto" />
        <p className="mt-6 text-slate-200 text-lg font-semibold">Generating 3D model...</p>
        <p className="mt-2 text-sm text-purple-300 font-mono bg-purple-500/10 px-3 py-1 rounded-full inline-block">{meshState.progress}% complete</p>
      </div>
    );
  }

  if (meshState.status === 'unknown') {
    return renderSourceImageOverlay(
      <div className="text-center">
        <p className="text-slate-200 text-lg font-semibold">Unknown model state</p>
        <p className="mt-2 text-sm text-slate-400">{meshState.reason}</p>
      </div>
    );
  }

  return (
    <Canvas shadows camera={{ position: [0, 0, 4], fov: 50 }}>
      <Suspense fallback={null}>
        <ambientLight intensity={0.5} />
        <directionalLight position={[10, 10, 10]} intensity={1} castShadow />
        <Environment preset="city" />
        {meshState.scene && (
          <Center>
            <primitive object={meshState.scene} />
          </Center>
        )}
      </Suspense>
      <OrbitControls makeDefault autoRotate enablePan={false} target={[0, 0, 0]} />
    </Canvas>
  );
};

const R2_BASE_URL = import.meta.env.VITE_R2_PUBLIC_URL?.replace(/\/$/, '') || '';
const getAssetUrls = (chain, contract, tokenId) => {
  const assetId = `${chain}:${contract.toLowerCase()}:${tokenId}`;
  return {
    image: `${R2_BASE_URL}/cast/${assetId}/image`,
    video: `${R2_BASE_URL}/cast/${assetId}/video`,
    thumbnail: `${R2_BASE_URL}/cast/${assetId}/thumbnail`,
    mesh: `${R2_BASE_URL}/cast/${assetId}/v1/mesh.glb`
  };
};

const DossierImage = ({ dossier }) => {
  const [videoFailed, setVideoFailed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState(null);

  const parts = dossier?.key?.split(':');
  const hasKey = parts?.length >= 3;
  const chain = hasKey ? parts[0] : null;
  const address = hasKey ? parts[1] : null;
  const tokenId = hasKey ? parts[2] : null;
  
  const urls = hasKey ? getAssetUrls(chain, address, tokenId) : null;

  useEffect(() => {
    if (!hasKey || (videoFailed && imageFailed) || !R2_BASE_URL) {
      let isMounted = true;
      const loadFallback = async () => {
        if (dossier?.sourceUrl) {
          if (isMounted) setFallbackUrl(dossier.sourceUrl);
          return;
        }
        if (dossier?.sourceImageUrls?.[0]) {
          if (isMounted) setFallbackUrl(dossier.sourceImageUrls[0]);
          return;
        }

        if (hasKey) {
          for (const collection of Object.values(nftsData)) {
            const found = collection?.nfts?.find((n) => n.tokenId === String(tokenId) && n.contract?.address?.toLowerCase() === address.toLowerCase());
            if (found) {
              const img = resolveNftImage(found);
              if (img && isMounted) {
                setFallbackUrl(img);
                return;
              }
            }
          }

          try {
            const fetched = await fetchNft({ chain, address, tokenId });
            if (fetched) {
              const img = resolveNftImage(fetched);
              if (img && isMounted) setFallbackUrl(img);
            }
          } catch (err) {
            console.error('Alchemy fallback failed:', err);
          }
        }
      };
      
      loadFallback();
      return () => { isMounted = false; };
    }
  }, [hasKey, videoFailed, imageFailed, dossier, chain, address, tokenId]);

  if (!hasKey && !fallbackUrl) {
    return <div className="absolute inset-0 bg-slate-800 animate-pulse" />;
  }

  const isFallbackVideo = fallbackUrl && typeof fallbackUrl === 'string' && fallbackUrl.match(/\.(mp4|webm|ogg|mov)(\?.*)?$/i);

  if ((videoFailed && imageFailed) || !R2_BASE_URL) {
    if (!fallbackUrl) return <div className="absolute inset-0 bg-slate-800 animate-pulse" />;
    
    if (isFallbackVideo) {
      return (
        <video 
          src={fallbackUrl} 
          autoPlay loop muted playsInline 
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-110" 
        />
      );
    }
    return (
      <img 
        src={fallbackUrl} 
        alt={dossier?.subject || 'NFT image'} 
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-110" 
      />
    );
  }

  if (!videoFailed) {
    return (
      <video 
        src={urls.video} 
        autoPlay loop muted playsInline 
        onError={() => setVideoFailed(true)}
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-110" 
      />
    );
  }

  if (!imageFailed) {
    return (
      <img 
        src={urls.image} 
        alt={dossier?.subject || 'NFT image'} 
        onError={() => setImageFailed(true)}
        className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-110" 
      />
    );
  }

  return <div className="absolute inset-0 bg-slate-800 animate-pulse" />;
};

const ThreeDPage = () => {
  const [inputUrl, setInputUrl] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateStatus, setGenerateStatus] = useState('');
  const [generateError, setGenerateError] = useState(null);
  const [generateEvents, setGenerateEvents] = useState([]);
  
  const [dossiers, setDossiers] = useState([]);
  const [skip, setSkip] = useState(0);
  const take = 10;
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [listComplete, setListComplete] = useState(false);
  
  const [selectedAsset, setSelectedAsset] = useState(null); // Will hold assetKey

  const fetchDossiers = async (currentSkip = 0, currentQuery = '', isReset = false) => {
    setIsLoadingList(true);
    try {
      const params = new URLSearchParams({
        skip: currentSkip.toString(),
        take: take.toString(),
      });
      if (currentQuery) {
        params.append('q', currentQuery);
      }
      const response = await fetch(`${import.meta.env.VITE_PROD_SERVER}/nfts/3d?${params.toString()}`);
      const result = await response.json();
      if (result.error) throw new Error(result.error);
      
      const rawItems = result.data || [];
      const newItems = rawItems.map(item => {
        const dd = item.dossier_data || {};
        return {
          ...dd,
          ...item,
          key: dd.key || item.key || (item.chain && item.contract && item.token_id ? `${item.chain}:${item.contract}:${item.token_id}` : undefined),
          subject: item.name || dd.subject || item.subject,
          description: item.ai_description || dd.description || item.description,
          sourceUrl: dd.source_url || item.sourceUrl,
          sourceImageUrls: dd.sourceImageUrls || item.sourceImageUrls
        };
      });
      setDossiers((prev) => isReset ? newItems : [...prev, ...newItems]);
      setListComplete(newItems.length < take);
    } catch (err) {
      console.error('Failed to load dossiers:', err);
    } finally {
      setIsLoadingList(false);
    }
  };

  useEffect(() => {
    fetchDossiers(0, '', true);
  }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    setSkip(0);
    fetchDossiers(0, searchQuery, true);
  };

  const handleLoadMore = () => {
    const nextSkip = skip + take;
    setSkip(nextSkip);
    fetchDossiers(nextSkip, searchQuery, false);
  };

  const handleGenerate = async (e) => {
    e.preventDefault();
    setGenerateError(null);
    setGenerateStatus('');
    setGenerateEvents([]);
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
      
      // Open modal immediately
      setSelectedAsset(key);
      setInputUrl('');
      
      setGenerateEvents([{ type: 'info', message: 'Resolved NFT address. Initiating sequence...' }]);

      const generateRequest = async () => {
        const response = await fetch(`${import.meta.env.VITE_PROD_SERVER}/3d-mesh/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ asset: key })
        });
        const data = await response.json();
        if (data.error) throw new Error(data.error);
        return data;
      };

      const checkStatusRequest = async () => {
        const response = await fetch(`${import.meta.env.VITE_PROD_SERVER}/3d-mesh?asset=${encodeURIComponent(key)}`);
        const contentType = response.headers.get('content-type') || '';
        
        if (contentType.includes('model/gltf') || contentType.includes('octet-stream')) {
          return { status: 'ready' };
        }

        const text = await response.text();
        if (text.startsWith('glTF')) {
          return { status: 'ready' };
        }

        try {
          const data = JSON.parse(text);
          if (data.error) throw new Error(data.error);
          return data;
        } catch (err) {
          if (err.name === 'SyntaxError') {
            return { status: 'ready' }; // Fallback for unrecognized binary
          }
          throw err;
        }
      };

      let data = await generateRequest();
      
      if (data.status === 'unknown') {
        setGenerateStatus('Initializing Casting Director...');
        setGenerateEvents(prev => [...prev, { type: 'process', message: 'Initializing Casting Director...' }]);
        
        await new Promise((resolve, reject) => {
          const es = new EventSource(`${import.meta.env.VITE_PROD_SERVER}/casting-director/${resolved.chain}/${resolved.address}/${resolved.tokenId}`);
          
          let isFinished = false;

          es.addEventListener('phase', (event) => {
            try {
              const phaseData = JSON.parse(event.data);
              const msg = phaseData.message || phaseData.phase || 'Synthesizing...';
              setGenerateStatus(msg);
              
              // Only store the details if we actually have fields other than message/phase
              const details = { ...phaseData };
              delete details.message;
              delete details.phase;
              
              setGenerateEvents(prev => [...prev, { 
                type: 'phase', 
                message: msg, 
                details: Object.keys(details).length > 0 ? details : null 
              }]);
            } catch (err) {
              // Ignore parse errors
            }
          });

          es.addEventListener('result', async (event) => {
            try {
              isFinished = true;
              es.close();

              const rawDossier = JSON.parse(event.data);
              const dd = rawDossier.dossier_data || {};
              const dossier = {
                ...dd,
                ...rawDossier,
                key: dd.key || rawDossier.key || (rawDossier.chain && rawDossier.contract && rawDossier.token_id ? `${rawDossier.chain}:${rawDossier.contract}:${rawDossier.token_id}` : undefined),
                subject: rawDossier.name || dd.subject || rawDossier.subject,
                description: rawDossier.ai_description || dd.description || rawDossier.description,
                sourceUrl: dd.source_url || rawDossier.sourceUrl,
                sourceImageUrls: dd.sourceImageUrls || rawDossier.sourceImageUrls
              };
              
              setGenerateStatus('Starting mesh generation...');
              setGenerateEvents(prev => [...prev, { type: 'success', message: 'Casting complete. Starting mesh generation...' }]);
              
              data = await generateRequest();
              
              // Update dossiers if needed
              setDossiers(prev => {
                if (prev.find(d => d.key === dossier.key)) return prev;
                return [dossier, ...prev];
              });
              
              resolve();
            } catch (err) {
              reject(err);
            }
          });

          es.addEventListener('error', (err) => {
            if (isFinished) return;
            es.close();
            
            let errMsg = 'Casting director stream failed';
            if (err.data) {
              try {
                const parsed = JSON.parse(err.data);
                if (parsed.error) errMsg = parsed.error;
              } catch (e) {
                errMsg = err.data;
              }
            }
            
            reject(new Error(errMsg));
          });
        });
      }
      
      if (data.status === 'pending') {
        setGenerateStatus('Generating 3D model...');
        setGenerateEvents(prev => [...prev, { type: 'process', message: 'Mesh generation is in progress...' }]);
        
        while (data.status === 'pending') {
          await new Promise(r => setTimeout(r, 3000));
          data = await checkStatusRequest();
          const msg = data.progress ? `Generating 3D model... ${data.progress}%` : 'Generating 3D model...';
          setGenerateStatus(msg);
        }
        
        if (data.status === 'ready' || data.status === 'success') {
          setGenerateStatus('Mesh generation complete.');
          setGenerateEvents(prev => [...prev, { type: 'success', message: 'Mesh generation complete.' }]);
        } else {
          setGenerateEvents(prev => [...prev, { type: 'error', message: `Generation stopped with status: ${data.status}` }]);
        }
      } else if (data.status !== 'unknown') {
        setGenerateEvents(prev => [...prev, { type: 'success', message: 'Asset already synthesized.' }]);
      }
      
    } catch (err) {
      setGenerateError(err.message);
      setGenerateEvents(prev => [...prev, { type: 'error', message: err.message }]);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 font-sans text-slate-50 pt-24 pb-32">
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute left-[-10%] top-[20%] h-[40%] w-[40%] rounded-full bg-purple-600/10 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] h-[40%] w-[40%] rounded-full bg-purple-700/15 blur-[120px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-7xl px-6">
        {/* Hero Section */}
        <motion.div 
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mx-auto max-w-4xl text-center"
        >
          <motion.div
            whileHover={{ scale: 1.02, rotateX: 2, rotateY: -2 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            style={{ perspective: 1000 }}
            className="inline-block bg-slate-900/40 backdrop-blur-xl border border-white/10 rounded-[3rem] p-8 md:p-12 shadow-[0_20px_50px_rgba(147,51,234,0.15)] ring-1 ring-inset ring-white/5"
          >
            <h1 className="headline-monster text-5xl md:text-7xl text-white tracking-tight drop-shadow-sm m-0">
              Forge NFTs into <span className="text-transparent bg-clip-text bg-gradient-to-r from-purple-400 via-fuchsia-400 to-purple-600 drop-shadow-[0_0_20px_rgba(168,85,247,0.3)]">Reality</span>
            </h1>
          </motion.div>
          <p className="mt-6 text-lg md:text-xl text-slate-400 font-light max-w-2xl mx-auto leading-relaxed">
            Harness the swarm to synthesize high-fidelity 3D meshes from any OpenSea link or contract address.
          </p>

          <form onSubmit={handleGenerate} className="mt-12 max-w-2xl mx-auto relative group">
            <div className="absolute -inset-1 bg-gradient-to-r from-purple-600 to-blue-600 rounded-[2rem] blur opacity-25 group-hover:opacity-40 transition duration-1000 group-hover:duration-200" />
            
            <div className="relative flex items-center bg-slate-900/80 backdrop-blur-xl border border-white/10 rounded-[2rem] p-2 shadow-2xl transition-all">
              <div className="pl-4 pr-3 flex items-center pointer-events-none text-slate-500 group-focus-within:text-purple-400 transition-colors">
                <Search className="w-5 h-5" />
              </div>
              <input
                type="text"
                className="w-full bg-transparent border-none py-3 pl-2 pr-4 text-slate-200 focus:outline-none focus:ring-0 placeholder-slate-500 font-medium text-base"
                placeholder="Paste NFT URL or 0x.../id"
                value={inputUrl}
                onChange={(e) => setInputUrl(e.target.value)}
              />
              <button
                type="submit"
                disabled={isGenerating || !inputUrl.trim()}
                className="shrink-0 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-8 py-3 rounded-full font-semibold tracking-wide transition-all shadow-[0_0_15px_rgba(147,51,234,0.3)] hover:shadow-[0_0_25px_rgba(147,51,234,0.5)] flex items-center gap-2"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    {generateStatus || 'Synthesizing...'}
                  </>
                ) : (
                  <>
                    Generate
                    <Sparkles className="w-4 h-4 ml-1" />
                  </>
                )}
              </button>
            </div>
            {generateError && (
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 text-sm text-rose-400 font-medium">
                {generateError}
              </motion.p>
            )}
          </form>
        </motion.div>

        {/* Existing Meshes List */}
        <div className="mt-32 relative z-10">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between border-b border-white/10 pb-6 mb-10 gap-4">
            <div>
              <h2 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
                <div className="p-2 bg-purple-500/20 rounded-lg">
                  <Database className="w-6 h-6 text-purple-400" />
                </div>
                Gallery
              </h2>
              <p className="mt-2 text-sm text-slate-400">Browse previously synthesized 3D dossiers.</p>
            </div>
            <form onSubmit={handleSearch} className="relative w-full md:w-auto md:min-w-[300px]">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-5 w-5 text-slate-400" />
              </div>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="block w-full pl-10 pr-3 py-2 border border-white/10 rounded-xl leading-5 bg-slate-900/50 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500/50 focus:border-purple-500/50 sm:text-sm transition-all shadow-inner"
                placeholder="Search collections, names..."
              />
              <button type="submit" className="hidden">Search</button>
            </form>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {dossiers.map((dossier, i) => (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                key={dossier.key}
                onClick={() => setSelectedAsset(dossier.key)}
                className="group relative aspect-[4/5] rounded-3xl overflow-hidden cursor-pointer bg-slate-900 border border-white/5 hover:border-purple-500/50 transition-all duration-300 shadow-xl hover:shadow-[0_0_30px_rgba(168,85,247,0.15)]"
              >
                <div className="absolute inset-0 bg-gradient-to-b from-transparent via-slate-900/20 to-slate-950/90 z-10 pointer-events-none" />
                <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:24px_24px] pointer-events-none opacity-20 group-hover:opacity-40 transition-opacity" />

                <div className="absolute top-4 left-4 z-20">
                  <span className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-purple-300 bg-purple-900/50 backdrop-blur-md rounded-full border border-purple-500/30">
                    {dossier.key.split(':')[0]}
                  </span>
                </div>

                <div className="absolute inset-0 z-0 opacity-50 group-hover:opacity-80 transition-opacity duration-500">
                  <DossierImage dossier={dossier} />
                </div>

                <div className="absolute bottom-0 inset-x-0 p-5 z-20 transform translate-y-2 group-hover:translate-y-0 transition-transform duration-300">
                  <h3 className="text-lg font-semibold text-white truncate drop-shadow-md">{dossier.subject || 'Unknown Subject'}</h3>
                  <p className="text-xs text-slate-400 uppercase tracking-widest mt-1.5 truncate font-mono opacity-80">{dossier.key.split(':').slice(1, 2).join(':')}</p>
                </div>
                
                <div className="absolute inset-0 z-30 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300 bg-slate-950/10 backdrop-blur-[2px]">
                   <div className="bg-purple-600 text-white rounded-full p-4 shadow-[0_0_20px_rgba(147,51,234,0.5)] transform scale-90 group-hover:scale-100 transition-transform duration-300">
                      <ArrowRight className="w-6 h-6" />
                   </div>
                </div>
              </motion.div>
            ))}
          </div>

          {isLoadingList && (
            <div className="py-24 flex flex-col items-center justify-center">
              <div className="relative w-24 h-24 mb-6 flex items-center justify-center" style={{ perspective: '800px' }}>
                <motion.div 
                  animate={{ rotateX: [0, 360], rotateY: [0, 360] }}
                  transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
                  className="relative w-12 h-12"
                  style={{ transformStyle: 'preserve-3d' }}
                >
                  {[
                    { transform: 'translateZ(24px)', color: 'border-purple-500/50 bg-purple-500/10' },
                    { transform: 'rotateY(180deg) translateZ(24px)', color: 'border-purple-500/50 bg-purple-500/10' },
                    { transform: 'rotateY(90deg) translateZ(24px)', color: 'border-blue-500/50 bg-blue-500/10' },
                    { transform: 'rotateY(-90deg) translateZ(24px)', color: 'border-blue-500/50 bg-blue-500/10' },
                    { transform: 'rotateX(90deg) translateZ(24px)', color: 'border-fuchsia-500/50 bg-fuchsia-500/10' },
                    { transform: 'rotateX(-90deg) translateZ(24px)', color: 'border-fuchsia-500/50 bg-fuchsia-500/10' },
                  ].map((face, i) => (
                    <div 
                      key={i}
                      className={`absolute inset-0 border backdrop-blur-sm shadow-[0_0_15px_rgba(168,85,247,0.2)] ${face.color}`}
                      style={{ transform: face.transform }}
                    />
                  ))}
                </motion.div>
                <motion.div 
                  animate={{ rotateX: [70, 70], rotateZ: [0, 360] }}
                  transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
                  className="absolute inset-2 rounded-full border border-purple-500/30" 
                  style={{ transformStyle: 'preserve-3d' }}
                />
              </div>
              <p className="text-purple-400 font-mono text-sm uppercase tracking-widest animate-pulse">Syncing Vault...</p>
            </div>
          )}

          {!isLoadingList && !listComplete && dossiers.length > 0 && (
            <div className="mt-16 flex justify-center">
              <button 
                onClick={handleLoadMore}
                className="chip px-8 py-3 text-sm font-semibold text-slate-300 hover:text-white transition-all shadow-[0_0_15px_rgba(255,255,255,0.05)] hover:shadow-[0_0_20px_rgba(255,255,255,0.1)]"
              >
                Load More Archives
              </button>
            </div>
          )}
          
          {!isLoadingList && dossiers.length === 0 && (
            <div className="py-24 text-center text-slate-500 flex flex-col items-center">
              <Database className="w-12 h-12 mb-4 opacity-20" />
              <p className="text-lg">The vault is currently empty.</p>
              <p className="text-sm opacity-70 mt-2">Generate a 3D mesh above to begin.</p>
            </div>
          )}
        </div>
      </div>

      {/* 3D Viewer HUD Modal */}
      {selectedAsset && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 md:p-8 bg-slate-950/90 backdrop-blur-xl">
          <div className="absolute top-8 left-8 w-16 h-16 border-t-2 border-l-2 border-purple-500/30 rounded-tl-3xl opacity-50" />
          <div className="absolute top-8 right-8 w-16 h-16 border-t-2 border-r-2 border-purple-500/30 rounded-tr-3xl opacity-50" />
          <div className="absolute bottom-8 left-8 w-16 h-16 border-b-2 border-l-2 border-purple-500/30 rounded-bl-3xl opacity-50" />
          <div className="absolute bottom-8 right-8 w-16 h-16 border-b-2 border-r-2 border-purple-500/30 rounded-br-3xl opacity-50" />

          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="relative w-full max-w-7xl bg-slate-900/60 border border-purple-500/20 rounded-3xl overflow-hidden shadow-[0_0_50px_rgba(147,51,234,0.1)] flex flex-col lg:flex-row h-[85vh] ring-1 ring-white/10"
          >
            {/* Left Panel: Info & Logs */}
            <div className="w-full lg:w-[400px] border-b lg:border-b-0 lg:border-r border-purple-500/20 bg-slate-950/80 flex flex-col relative z-20 flex-shrink-0">
              <div className="flex items-center justify-between px-6 py-4 border-b border-purple-500/20 bg-slate-950/70 backdrop-blur-md">
                <div className="flex items-center gap-3">
                  <div className={`h-2 w-2 rounded-full shadow-[0_0_10px_currentColor] animate-pulse ${isGenerating ? 'bg-amber-400 text-amber-400' : 'bg-emerald-400 text-emerald-400'}`} />
                  <h3 className="text-sm font-mono tracking-widest uppercase text-purple-200 truncate max-w-[200px]">
                    3D GENERATION
                  </h3>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-6 scrollbar-thin scrollbar-thumb-purple-900 scrollbar-track-transparent">
                {/* Asset Info */}
                {(() => {
                  const dossier = dossiers.find(d => d.key === selectedAsset);
                  const partialDossier = dossier || { key: selectedAsset };
                  return (
                    <div className="space-y-4">
                      <div className="aspect-square rounded-2xl overflow-hidden relative border border-white/10 bg-slate-900 shadow-xl max-h-[300px] mx-auto">
                        <DossierImage dossier={partialDossier} />
                        <div className="absolute inset-0 ring-1 ring-inset ring-white/10 rounded-2xl pointer-events-none" />
                      </div>
                      
                      {dossier ? (
                        <div className="bg-white/5 rounded-xl p-4 border border-white/10">
                          <h3 className="text-xl font-bold text-white mb-2">{dossier.subject || 'Unknown Asset'}</h3>
                          <p className="text-sm text-slate-400 leading-relaxed">{dossier.description || 'No description available for this asset.'}</p>
                          <div className="mt-4 pt-4 border-t border-white/10 flex flex-wrap gap-2">
                             <a 
                               href={`https://opensea.io/assets/${selectedAsset.split(':')[0] === 'eth' ? 'ethereum' : selectedAsset.split(':')[0]}/${selectedAsset.split(':')[1]}/${selectedAsset.split(':')[2]}`}
                               target="_blank" 
                               rel="noreferrer"
                               className="px-2 py-1 bg-purple-500/20 hover:bg-purple-500/40 text-purple-300 rounded text-[10px] font-mono transition-colors cursor-pointer flex items-center gap-1"
                               title="View on OpenSea"
                             >
                               {selectedAsset.split(':')[1].slice(0,6)}...{selectedAsset.split(':')[1].slice(-4)}
                               <ArrowRight className="w-3 h-3 -rotate-45" />
                             </a>
                             <span className="px-2 py-1 bg-blue-500/20 text-blue-300 rounded text-[10px] font-mono">ID: {selectedAsset.split(':')[2]}</span>
                             
                             {dossier.txhash && (
                               <a 
                                 href={`https://etherscan.io/tx/${dossier.txhash}`}
                                 target="_blank" 
                                 rel="noreferrer"
                                 className="px-2 py-1 bg-emerald-500/20 hover:bg-emerald-500/40 text-emerald-300 rounded text-[10px] font-mono transition-colors cursor-pointer flex items-center gap-1"
                                 title="View Transaction"
                               >
                                 TX: {dossier.txhash.slice(0,6)}...{dossier.txhash.slice(-4)}
                                 <ArrowRight className="w-3 h-3 -rotate-45" />
                               </a>
                             )}
                          </div>
                        </div>
                      ) : (
                         <div className="bg-white/5 rounded-xl p-4 border border-white/10 animate-pulse">
                           <div className="h-6 bg-white/10 rounded w-2/3 mb-4" />
                           <div className="h-4 bg-white/10 rounded w-full mb-2" />
                           <div className="h-4 bg-white/10 rounded w-4/5" />
                         </div>
                      )}
                    </div>
                  );
                })()}

                {/* Event Logs Terminal */}
                {(generateEvents.length > 0 || isGenerating) && (
                  <div className="bg-slate-950 border border-white/10 rounded-xl overflow-hidden shadow-inner font-mono text-xs text-slate-300 flex flex-col flex-shrink-0">
                    <div className="bg-slate-900/80 px-4 py-2 border-b border-white/10 flex items-center justify-between sticky top-0 z-10">
                      <span className="text-purple-400 uppercase tracking-widest font-semibold flex items-center gap-2">
                        <Loader2 className={`w-3 h-3 ${isGenerating ? 'animate-spin' : 'hidden'}`} />
                        System Logs
                      </span>
                    </div>
                    <div className="p-4 space-y-3 overflow-y-auto max-h-[250px]">
                      {generateEvents.map((ev, idx) => (
                        <div key={idx} className="flex flex-col gap-1 items-start mb-2 border-b border-white/5 pb-2 last:border-0 last:pb-0 last:mb-0">
                          <div className="flex gap-2 items-start">
                            <span className="text-slate-600 select-none">›</span>
                            <span className={`${
                              ev.type === 'error' ? 'text-rose-400' :
                              ev.type === 'success' ? 'text-emerald-400' :
                              ev.type === 'info' ? 'text-blue-400' :
                              'text-slate-300'
                            }`}>
                              {ev.message}
                            </span>
                          </div>
                          {ev.details && (
                             <div className="ml-4 mt-1 p-2 bg-black/40 rounded border border-white/10 text-[10px] text-slate-400 font-mono w-full overflow-x-auto shadow-inner">
                               <pre>{JSON.stringify(ev.details, null, 2)}</pre>
                             </div>
                          )}
                        </div>
                      ))}
                      {isGenerating && (
                        <div className="flex gap-2 items-start text-amber-400/70 animate-pulse">
                          <span className="select-none">›</span>
                          <span>Awaiting next sequence...</span>
                        </div>
                      )}
                      <div ref={(el) => { el?.scrollIntoView({ behavior: 'smooth' }) }} />
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right Panel: 3D Canvas */}
            <div className="flex-1 relative bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-slate-800 via-slate-900 to-slate-950 flex flex-col">
              <div className="absolute top-6 right-6 z-50">
                <button 
                  onClick={() => {
                    setSelectedAsset(null);
                    setGenerateEvents([]);
                  }}
                  className="group flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-slate-400 hover:text-white transition-all bg-slate-950/50 hover:bg-slate-900/80 px-4 py-2 rounded-full border border-white/10 backdrop-blur-md shadow-lg"
                >
                  <span className="hidden sm:inline">Close</span>
                  <div className="p-1 rounded-full bg-white/5 group-hover:bg-rose-500/20 group-hover:text-rose-400 transition-colors">
                    <X className="w-4 h-4" />
                  </div>
                </button>
              </div>

              <div className="absolute inset-0 bg-[linear-gradient(transparent_50%,rgba(0,0,0,0.1)_50%)] bg-[length:100%_4px] pointer-events-none opacity-20 z-10" />
              
              <div className="absolute inset-0 z-0">
                <ThreeDViewer 
                  currentAssetKey={selectedAsset} 
                  dossier={dossiers.find(d => d.key === selectedAsset) || { key: selectedAsset }} 
                  isGenerating={isGenerating}
                  generateStatus={generateStatus}
                />
              </div>
              
              <div className="absolute bottom-6 left-6 z-20 pointer-events-none hidden sm:block">
                <div className="bg-slate-950/60 backdrop-blur-md border border-white/5 rounded-xl p-3 inline-flex gap-4 shadow-lg">
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest font-mono">Status</p>
                    <p className="text-xs text-emerald-400 font-mono mt-0.5">ONLINE</p>
                  </div>
                  <div className="w-px bg-white/10" />
                  <div>
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest font-mono">Engine</p>
                    <p className="text-xs text-slate-300 font-mono mt-0.5">WebGL 2.0</p>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};

export default ThreeDPage;
