import { Brain, Cpu, ShieldAlert, FileText, Film, Gem, ArrowRightLeft, Video } from 'lucide-react';

const SwarmDiagram = () => {
  return (
    <div className="glass-panel rounded-3xl p-6 md:p-8 mt-12 bg-slate-950/40 relative overflow-hidden border border-white/10 shadow-[0_14px_40px_-12px_rgb(var(--brand-rgb)/0.1)]">
      {/* Background radial glow */}
      <div className="absolute inset-0 -z-10 pointer-events-none overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] rounded-full bg-purple-950/10 blur-[80px]" />
      </div>

      <div className="flex flex-col gap-2 mb-6">
        <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-400 flex items-center gap-2">
          <ArrowRightLeft className="w-4 h-4 text-purple-400" /> Orchestration & Attribution Flow
        </h3>
        <p className="text-xs text-slate-400 max-w-2xl leading-relaxed">
          Your{' '}
          <a
            href="https://hellominds.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="text-purple-400 underline decoration-purple-500/50 underline-offset-4 hover:text-purple-300 transition-colors"
          >
            mind
          </a>{' '}
          is the Producer, managing the budget and overseeing the specialized agent swarm. As the agents run, they automatically access premium content and provenance data over the x402 protocol.
        </p>
      </div>

      {/* SVG Diagram Container with horizontal scrolling on tiny screens */}
      <div className="overflow-x-auto select-none">
        <svg
          viewBox="0 0 1000 450"
          width="100%"
          height="auto"
          className="min-w-[800px] block"
          xmlns="http://www.w3.org/2000/svg"
        >
          <style>
            {`
              .swarm-wire {
                fill: none;
                stroke: #23123a;
                stroke-width: 2;
              }
              .swarm-wire-dash {
                fill: none;
                stroke: #311c4e;
                stroke-width: 1;
                stroke-dasharray: 4 6;
              }
              .swarm-pulse {
                fill: none;
                stroke-linecap: round;
                stroke-width: 3;
                animation: swarmFlow 8s linear infinite;
              }
              .pulse-control {
                stroke: #10b981; /* green */
                stroke-dasharray: 8 80;
              }
              .pulse-data {
                stroke: #a855f7; /* purple */
                stroke-dasharray: 8 60;
                animation-duration: 6s;
              }
              .pulse-pay {
                stroke: #f59e0b; /* amber for gold coins */
                stroke-width: 3;
                stroke-dasharray: 6 50;
                animation: payFlow 5s linear infinite;
              }
              .pulse-asset {
                stroke: #ec4899; /* pink for premium assets */
                stroke-width: 3;
                stroke-dasharray: 6 50;
                animation: payFlow 5s linear infinite;
                animation-delay: 2.5s; /* alternate phases */
              }
              
              @keyframes swarmFlow {
                from { stroke-dashoffset: 150; }
                to { stroke-dashoffset: 0; }
              }
              @keyframes payFlow {
                from { stroke-dashoffset: 150; }
                to { stroke-dashoffset: 0; }
              }

              .node-bg {
                fill: #0c0715;
                stroke: #331954;
                stroke-width: 1.5;
                transition: all 0.3s ease;
              }
              .node-bg-active {
                stroke: #a855f7;
                filter: drop-shadow(0px 0px 8px rgba(168, 85, 247, 0.3));
              }
              .node-bg-producer {
                stroke: #10b981;
                filter: drop-shadow(0px 0px 8px rgba(16, 185, 129, 0.25));
              }
              .node-bg-paywall {
                stroke: #ec4899;
                filter: drop-shadow(0px 0px 8px rgba(236, 72, 153, 0.25));
              }
              .node-text {
                font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
                font-size: 11px;
                font-weight: 600;
                fill: #94a3b8;
                text-anchor: middle;
                letter-spacing: 0.05em;
              }
              .node-subtext {
                font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
                font-size: 9px;
                fill: #64748b;
                text-anchor: middle;
              }
              .edge-text {
                font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
                font-size: 10px;
                fill: #475569;
                text-anchor: middle;
              }
            `}
          </style>

          <defs>
            {/* Arrows */}
            <marker id="arrow" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#331954" />
            </marker>
            <marker id="arrow-producer" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#10b981" />
            </marker>
            <marker id="arrow-pay" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#f59e0b" />
            </marker>
            <marker id="arrow-asset" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#ec4899" />
            </marker>
          </defs>

          {/* Connections (Wires) */}
          <g>
            {/* Attribution reporting up to Producer */}
            <path d="M 120 200 L 440 115" className="swarm-wire" />

            {/* Producer controls down to agents */}
            <path d="M 500 120 L 500 200" className="swarm-wire" />
            <path d="M 500 120 L 880 200" className="swarm-wire" />

            {/* Pipeline flow */}
            <path d="M 175 220 L 255 220" className="swarm-wire" />
            <path d="M 365 220 L 445 220" className="swarm-wire" />
            <path d="M 555 220 L 635 220" className="swarm-wire" />
            <path d="M 745 220 L 825 220" className="swarm-wire" />

            {/* x402 Payments (swarm -> Premium Assets) */}
            <path d="M 115 250 L 440 345" className="swarm-wire-dash" />
            <path d="M 300 245 L 450 335" className="swarm-wire-dash" />
            <path d="M 493 250 L 493 330" className="swarm-wire-dash" />
            <path d="M 690 245 L 540 335" className="swarm-wire-dash" />
            <path d="M 875 250 L 560 345" className="swarm-wire-dash" />

            {/* Premium Assets Delivery (Premium Assets -> swarm) */}
            <path d="M 450 355 L 125 260" className="swarm-wire-dash" />
            <path d="M 460 345 L 310 255" className="swarm-wire-dash" />
            <path d="M 507 330 L 507 250" className="swarm-wire-dash" />
            <path d="M 550 345 L 700 255" className="swarm-wire-dash" />
            <path d="M 560 355 L 885 260" className="swarm-wire-dash" />
          </g>

          {/* Flow Pulses */}
          <g>
            {/* Attribution Pulse up */}
            <path d="M 120 200 L 440 115" className="swarm-pulse pulse-control" style={{ animationDirection: 'reverse' }} />

            {/* Control Pulses down */}
            <path d="M 500 120 L 500 200" className="swarm-pulse pulse-control" />
            <path d="M 500 120 L 880 200" className="swarm-pulse pulse-control" />

            {/* Pipeline Data Pulses */}
            <path d="M 175 220 L 255 220" className="swarm-pulse pulse-data" />
            <path d="M 365 220 L 445 220" className="swarm-pulse pulse-data" />
            <path d="M 555 220 L 635 220" className="swarm-pulse pulse-data" />
            <path d="M 745 220 L 825 220" className="swarm-pulse pulse-data" />

            {/* x402 Coin Pulses (payments down) */}
            <path d="M 115 250 L 440 345" className="swarm-pulse pulse-pay" />
            <path d="M 300 245 L 450 335" className="swarm-pulse pulse-pay" />
            <path d="M 493 250 L 493 330" className="swarm-pulse pulse-pay" />
            <path d="M 690 245 L 540 335" className="swarm-pulse pulse-pay" />
            <path d="M 875 250 L 560 345" className="swarm-pulse pulse-pay" />

            {/* Premium Assets Delivery Pulses (assets up) */}
            <path d="M 450 355 L 125 260" className="swarm-pulse pulse-asset" />
            <path d="M 460 345 L 310 255" className="swarm-pulse pulse-asset" />
            <path d="M 507 330 L 507 250" className="swarm-pulse pulse-asset" />
            <path d="M 550 345 L 700 255" className="swarm-pulse pulse-asset" />
            <path d="M 560 355 L 885 260" className="swarm-pulse pulse-asset" />
          </g>

          {/* Labels */}
          <g>
            <text x="270" y="145" className="edge-text" fill="#10b981">Administers attribution</text>
            <text x="500" y="160" className="edge-text">Logline Params</text>
            <text x="730" y="145" className="edge-text">Approve Budget</text>

            <text x="215" y="210" className="edge-text">Dossier</text>
            <text x="405" y="210" className="edge-text">Reviewed</text>
            <text x="595" y="210" className="edge-text">Beats</text>
            <text x="785" y="210" className="edge-text">Frames</text>

            <text x="220" y="325" className="edge-text" fill="#f59e0b">x402</text>
            <text x="340" y="300" className="edge-text" fill="#f59e0b">x402</text>
            <text x="465" y="290" className="edge-text" fill="#f59e0b">x402</text>
            <text x="655" y="300" className="edge-text" fill="#f59e0b">x402</text>
            <text x="780" y="325" className="edge-text" fill="#f59e0b">x402</text>
          </g>

          {/* Node 1: MIND (PRODUCER) */}
          <g transform="translate(500,100)">
            <rect x="-60" y="-35" width="120" height="70" rx="16" className="node-bg node-bg-producer" />
            <g transform="translate(-12, -22)">
              <Brain className="w-6 h-6 text-emerald-400" />
            </g>
            <text className="node-text" y="18" fill="#10b981">PRODUCER</text>
            <text className="node-subtext" y="29">Connected Mind</text>
          </g>

          {/* Node 2: CASTING DIRECTOR (Analyst) */}
          <g transform="translate(120,220)">
            <rect x="-55" y="-30" width="110" height="60" rx="12" className="node-bg node-bg-active" />
            <g transform="translate(-10, -22)">
              <Cpu className="w-5 h-5 text-purple-400" />
            </g>
            <text className="node-text" y="14">ANALYST</text>
            <text className="node-subtext" y="24">Casting Director</text>
          </g>

          {/* Node 3: PREVIS SUPERVISOR (Reviewer) */}
          <g transform="translate(310,220)">
            <rect x="-55" y="-30" width="110" height="60" rx="12" className="node-bg node-bg-active" />
            <g transform="translate(-10, -22)">
              <ShieldAlert className="w-5 h-5 text-purple-400" />
            </g>
            <text className="node-text" y="14">REVIEWER</text>
            <text className="node-subtext" y="24">Previs Supervisor</text>
          </g>

          {/* Node 4: SCREENWRITER */}
          <g transform="translate(500,220)">
            <rect x="-55" y="-30" width="110" height="60" rx="12" className="node-bg node-bg-active" />
            <g transform="translate(-10, -22)">
              <FileText className="w-5 h-5 text-purple-400" />
            </g>
            <text className="node-text" y="14">WRITER</text>
            <text className="node-subtext" y="24">Screenwriter</text>
          </g>

          {/* Node 5: STORYBOARDER */}
          <g transform="translate(690,220)">
            <rect x="-55" y="-30" width="110" height="60" rx="12" className="node-bg node-bg-active" />
            <g transform="translate(-10, -22)">
              <Film className="w-5 h-5 text-purple-400" />
            </g>
            <text className="node-text" y="14">ARTIST</text>
            <text className="node-subtext" y="24">Storyboarder</text>
          </g>

          {/* Node 6: VIDEO GEN (Director) */}
          <g transform="translate(880,220)">
            <rect x="-55" y="-30" width="110" height="60" rx="12" className="node-bg node-bg-active" />
            <g transform="translate(-10, -22)">
              <Video className="w-5 h-5 text-purple-400" />
            </g>
            <text className="node-text" y="14">DIRECTOR</text>
            <text className="node-subtext" y="24">Video Gen</text>
          </g>

          {/* Node 7: PREMIUM ASSETS */}
          <g transform="translate(500,360)">
            <rect x="-65" y="-30" width="130" height="60" rx="12" className="node-bg node-bg-paywall" />
            <g transform="translate(-10, -22)">
              <Gem className="w-5 h-5 text-pink-400" />
            </g>
            <text className="node-text" y="14" fill="#f472b6">PREMIUM ASSETS</text>
            <text className="node-subtext" y="24">Hi-Res Art & Wireframes</text>
          </g>
        </svg>
      </div>
    </div>
  );
};

export default SwarmDiagram;
