import { View } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';

// ONE WebGL context for every beat tile on the page.
//
// The obvious build — a <Canvas> per beat card — hits a hard browser limit: contexts are capped
// at roughly 8-16 per page, and the oldest gets killed silently when a new one is created. A
// six-beat storyboard would sit right on that line, and a storyboard plus an expanded modal would
// cross it. drei's <View> solves it properly: one canvas, one context, scissored into as many
// viewports as there are tracked elements.
//
// The canvas is fixed and covers the viewport, painting only inside the rectangles the tiles
// track. `pointer-events: none` keeps it from swallowing clicks meant for the UI underneath;
// interaction arrives through `eventSource`, the real DOM tree, so a drag on a tile reaches its
// own view and a click on a button beside it reaches the button.
//
// z-index is wedged deliberately between two things: ABOVE the neural-canvas overlay (z-50),
// which otherwise paints its own background straight over every tile — the symptom is a row of
// black rectangles where the 3D should be, and it is not obvious from the code that a fixed
// canvas is even involved — and BELOW the frame modal (z-70), which renders its own context so it
// must be able to cover the grid rather than be covered by it.
const ViewCanvas = ({ eventSource }) => (
  <Canvas
    eventSource={eventSource}
    className="pointer-events-none"
    style={{ position: 'fixed', inset: 0, zIndex: 55, pointerEvents: 'none' }}
    gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
    dpr={[1, 2]}
  >
    <View.Port />
  </Canvas>
);

export default ViewCanvas;
