# FileMind

FileMind is a privacy-friendly desktop AI file manager that turns messy local folders into organized, reviewable plans. It opens as an Electron app, guides you through an organization wizard, scans one or more source directories, proposes a smarter folder structure, lets you request revisions or manually make modifications, and only touches your files after you confirm.

## Screenshots

![FileMind source selection](./screenshots/Screenshot1.png)

The source selection screen is where you begin a new organization run by choosing the folder or folders FileMind should scan.

![FileMind directory scan](./screenshots/Screenshot2.png)

The review screen compares the current folder tree with FileMind's proposed organization, including move counts, reasoning, blocked items, and controls for requesting changes or approving the plan.

![FileMind completion screen](./screenshots/Screenshot4.png)

The completion screen confirms that the approved moves were applied and offers an undo option or a quick way to start another scan.

## What You Need

- Node.js 20 or newer
- npm
- Ollama installed locally

## Install Ollama

Download Ollama from:

https://ollama.com/download

After installing it, start Ollama. On most systems it runs automatically. You can check it from a terminal:

```bash
ollama --version
```

## Local Models

On launch, FileMind checks Ollama for its two supported local models and automatically downloads any that are missing:

```bash
ollama pull qwen3:14b
ollama pull qwen3:4b
```

In the app, `qwen3:14b` appears as **High Effort** and `qwen3:4b` appears as **Low Effort**. High Effort is recommended when your computer can comfortably run the larger model; Low Effort is faster for smaller machines.

The first launch can take a while because High Effort is large. If both models are already installed, FileMind skips the download. Ollama automatically uses supported GPU acceleration when it can, and FileMind asks Ollama to offload model layers to the GPU where available.

## Install From Source

From this folder:

```bash
npm install
```

## Run The Desktop App

```bash
npm start
```

This launches the FileMind desktop window. During development, Electron also starts a local renderer server behind the scenes. You do not need to open that server in your browser.

## Use FileMind

1. Choose one or more source directories.
2. Confirm whether FileMind should read short text previews for AI context. Scans include hidden files and recurse through selected directories without a depth limit.
3. Click **Scan**.
4. Review the current directory map or tree.
5. Pick **High Effort** or **Low Effort** from the local model dropdown next to **Generate**.
6. Click **Generate**.
7. Review the proposed before/after organization, blocked moves, and move reasons.
8. Optional: click **Request Changes** to regenerate the plan with extra instructions.
9. Optional: in the after view, drag-select, Ctrl-click, or Shift-click items and drag them onto another folder to manually edit the plan.
10. Choose **Yes, perform actions** only when you are ready.

After applying moves, FileMind writes an undo manifest so the last applied plan can be undone from the app.

## Developer Commands

```bash
npm test
npm run build
npm run check
```

- `npm test` runs the test suite.
- `npm run build` type-checks and builds the Electron app files.
- `npm run check` runs tests and verifies the local build.


## If Ollama Is Not Detected

Start Ollama and make sure it is reachable at:

```text
http://localhost:11434
```

Then reopen FileMind. Once Ollama is reachable, FileMind will install the missing local models automatically.
