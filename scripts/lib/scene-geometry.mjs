// Re-export shim. The grader itself now lives in worker/scene.js, promoted verbatim after
// round 7 passed — see that file's header.
//
// This file stays because the probe runner, the scorer and the report writer all import from
// it, and because the shim is what guarantees the probe keeps scoring EXACTLY the code
// production accepts. A copy would have started drifting the first time either side was
// touched; a re-export cannot.
export * from '../../worker/scene.js';
