# Stocking Tears Web 3D

Real-time WebGL / Three.js interactive tearable cloth & stocking physics demo inspired by Sakura Rabbit's Unity showcase.

## Live Demo
https://fizzeat.github.io/stocking-tears-web/

## Features
- **Tearable Cloth & Vertical Ladders**: Real-time Verlet cloth simulation with local tearing, frayed nylon strands, vertical stocking runs, and coupled raised-skin bulge inside tear openings.
- **Custom GLSL Shaders**: Fresnel sheerness, weave micro-normals, tension wrinkles, pearlescent micro-glint sparkles, and stretch-clearing frost opacity (16 live Inspector parameters + 4 presets).
- **3-Stage Interactive Challenge Mode**:
  1. Peel down ribbed knit outer socks
  2. Roll down sheer stockings
  3. Untie the pleated skirt satin ribbon bow
- **Procedural Web Audio Foley**: Synthesized tear snaps, fabric slide rustle, and stage clear chimes.
- **Custom `.glb` Model Import**: Load your own `.glb` / `.gltf` 3D model directly in the browser.

## Controls
- **Left Drag**: Grab / pull / tear / roll down
- **Right Drag / Wheel**: Orbit & zoom camera
- **`1`**: Pin / release gloved hand
- **`2`**: Repair tears & pull stockings back up

## Local Development
```bash
npm install
npm run dev
```
