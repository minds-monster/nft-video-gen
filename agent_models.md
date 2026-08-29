# minds.MONSTER Swarm Agents & AI Models Reference

This file contains the list of AI models running behind each agent in the minds.MONSTER swarm.

---

## 1. Swarm Core (Producer Agent)
* **Model**: `MiniMax-M3` (as served by hellominds.ai)
* **Role**: Orchestrates pipeline state, monitors budget limits, and handles queue scheduling.

## 2. Casting Director (Analyst)
* **Model**: `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` (via NVIDIA NIM)
* **Role**: Analyzes visual assets (NFTs) and resolves 3D mesh dossiers.

## 3. Screenwriter
* **Model**: `nvidia/nemotron-3-super-120b-a12b` (via NVIDIA NIM)
* **Role**: Translates user prompts and character files into screenplay dialogue and scene actions.

## 4. Storyboarder
* **Paid Tier Model**: `gpt-5.6-sol` (via OpenAI API)
* **Free Tier Model**: `nvidia/nemotron-3-ultra-550b-a55b:free` (via OpenRouter)
* **Role**: Calculates visual spatial layout, camera coordinates, and shot blocking.

## 5. Director (Film Assembly & Render)
* **Video Generation**: `MiniMax-H3` (Hailuo 3.0) & `MiniMax-Hailuo-02` (via MiniMax API)
* **Audio Scoring**: `music-3.0` (MiniMax Music Engine)
* **Voiceover**: `speech-02-hd` (MiniMax Voice Engine)
* **Quality Judgement**: `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning` (reused to judge rendered clip quality)

---

## 6. Landing Page chatbot (Site Assistant)
* **Model**: `minimaxai/minimax-m3` (via MiniMax API)
* **Role**: Powers the interactive Mind chat bubble on the homepage.
