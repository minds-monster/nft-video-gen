import { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Play } from 'lucide-react';
import { cn } from '../lib/cn';
import examples from '../data/examples.json';

const VideoCard = ({ video, index }) => {
  const [shouldLoad, setShouldLoad] = useState(index < 3);
  const [isPlaying, setIsPlaying] = useState(false);
  const containerRef = useRef(null);

  useEffect(() => {
    if (shouldLoad) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setShouldLoad(true);
          observer.disconnect();
        }
      },
      { rootMargin: '400px', threshold: 0.1 }
    );

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, [shouldLoad]);

  return (
    <div className="w-[90vw] sm:w-[80vw] md:w-[65vw] lg:w-[45%] xl:w-[31%] shrink-0 flex justify-center snap-start px-4 sm:px-8 py-4">
      <div 
        ref={containerRef}
        className="glass-panel relative flex h-auto flex-col overflow-hidden rounded-2xl w-full"
      >
        <div 
          className="relative aspect-video w-full bg-black/80 flex items-center justify-center group cursor-pointer" 
          onClick={() => !isPlaying && setIsPlaying(true)}
        >
          {shouldLoad ? (
            <>
              <video
                src={video.gatewayUrl}
                controls={isPlaying}
                autoPlay={isPlaying}
                preload="metadata"
                playsInline
                className="absolute inset-0 h-full w-full object-contain"
              />
              {!isPlaying && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/20 opacity-0 group-hover:opacity-100 transition-all duration-300">
                  <div className="bg-black/60 border border-white/20 rounded-full p-4 backdrop-blur-md shadow-2xl scale-90 group-hover:scale-100 transition-all duration-300">
                    <Play className="w-10 h-10 text-white fill-white ml-1" />
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="absolute inset-0 bg-slate-900 animate-pulse flex items-center justify-center">
              <span className="text-xs text-slate-600">Loading...</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const ExamplesSection = ({ className }) => {
  const scrollContainerRef = useRef(null);

  if (!examples || examples.length === 0) return null;

  const scroll = (direction) => {
    if (scrollContainerRef.current && scrollContainerRef.current.firstElementChild) {
      const scrollAmount = scrollContainerRef.current.firstElementChild.clientWidth;
      scrollContainerRef.current.scrollBy({ 
        left: direction === 'left' ? -scrollAmount : scrollAmount, 
        behavior: 'smooth' 
      });
    }
  };

  return (
    <section className={cn('bg-slate-950 py-16', className)}>
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-10 text-center">
          <h2 className="text-3xl uppercase tracking-tight shadow-type md:text-4xl">
            Recent Creations
          </h2>
          <p className="mt-2 text-sm text-slate-400">
            A selection of videos produced by our community of directors.
          </p>
        </div>
      </div>

      <div className="relative mx-auto w-full 2xl:max-w-[2000px] group/carousel px-4 sm:px-8 md:px-12">
        <button
          onClick={() => scroll('left')}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10 p-2 text-white/50 hover:text-white bg-black/40 hover:bg-black/80 rounded-full backdrop-blur transition-all opacity-100 sm:opacity-0 sm:group-hover/carousel:opacity-100 focus:opacity-100"
          aria-label="Previous videos"
        >
          <ChevronLeft className="w-6 h-6 sm:w-8 sm:h-8" />
        </button>

        <div className="marquee-mask overflow-hidden">
          <div 
            ref={scrollContainerRef}
            className="flex w-full snap-x snap-mandatory overflow-x-auto pb-12 pt-8 hide-scrollbar"
          >
            {examples.map((video, index) => (
              <VideoCard key={`${video.cid}-${index}`} video={video} index={index} />
            ))}
          </div>
        </div>

        <button
          onClick={() => scroll('right')}
          className="absolute right-0 top-1/2 -translate-y-1/2 z-10 p-2 text-white/50 hover:text-white bg-black/40 hover:bg-black/80 rounded-full backdrop-blur transition-all opacity-100 sm:opacity-0 sm:group-hover/carousel:opacity-100 focus:opacity-100"
          aria-label="Next videos"
        >
          <ChevronRight className="w-6 h-6 sm:w-8 sm:h-8" />
        </button>
      </div>
    </section>
  );
};

export default ExamplesSection;
