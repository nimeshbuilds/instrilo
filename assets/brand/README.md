# Instrilo brand kit

**Build with intent. Ship with evidence.**

Instrilo (in-STRILL-oh) takes its name from instructions becoming working systems. It is an open-source agent creation workbench by **nimeshbuilds**. The message is practical: turn product guidance into code you own, then inspect and evaluate its behavior.

The tagline states the product direction. Version 0.1 has evaluation reports and build fingerprints; requirement-linked release gates, replay, and safe code-preserving upgrades are planned in the [roadmap](../../docs/ROADMAP.md).

## Assets

| File | Use |
| --- | --- |
| [icon.svg](icon.svg) | App icon, avatar, favicon; 256 × 256 vector master |
| [icon.png](icon.png) | 512 × 512 transparent PNG rendered from the vector master |
| [mark.svg](mark.svg) | Transparent standalone mark on light backgrounds |
| [wordmark.svg](wordmark.svg) | Horizontal logo with publisher attribution; live system-font text |
| [banner.png](banner.png) | 2048 × 683 README and announcement banner |
| [brand-board.html](brand-board.html) | Open locally to inspect the identity, palette, and marks |

The app's `src/web/icon.svg` is a checked-in copy of the icon master. Keep both identical when changing the mark. Raster artwork is decorative; the vector mark is the authoritative small-size icon.

## Visual language

Three lines of guidance lead into a folded check mark: intent becomes evidence. Paper folds and readable type give the product a human, deliberate character. Use generous spacing, clear labels, and actual product results. Avoid robots, brains, magic-wand promises, and suggesting that a judge score proves correctness.

| Token | Hex | Role |
| --- | --- | --- |
| Forest | `#244E3A` | Primary ink, icon background, primary actions |
| Paper | `#F6F5F1` | Page background |
| Lime | `#DCEB92` | Mark and restrained accents |
| Sage | `#92AE76` | Fold depth and supporting illustration |
| Ink | `#242923` | Body text |

Use Georgia or a comparable editorial serif for the wordmark and display art. The application uses the platform sans-serif stack; code uses the platform monospace stack. No remote font service is needed. Use dark forest text on paper; lime is an accent, not body text on white.

Keep the icon at least 24 px where possible and use a margin of one guidance-line height around the mark. Preserve the square proportions. Spell the product **Instrilo**, the command `instrilo`, and the publisher **nimeshbuilds**. Do not imply endorsement by a model vendor or Andrew Ng.

## Name screening

Preliminary exact-name web, GitHub repository, npm registry, and PyPI checks on September 24, 2026 found no relevant existing Instrilo product or exact package metadata. This is a preliminary collision screen, not trademark clearance or proof that a namespace/domain can be registered. No domain or package name was reserved.

Queries: [GitHub](https://api.github.com/search/repositories?q=instrilo%20in%3Aname), [npm](https://registry.npmjs.org/instrilo), [PyPI](https://pypi.org/pypi/instrilo/json).

## Artwork provenance

The SVG assets were authored as editable vectors for this repository. The banner was generated with the Imagegen skill using the built-in image generation tool in **generate** mode, then copied unchanged into this directory. It is an illustration, not a screenshot of the running app. Repository assets are distributed under the project's [Apache-2.0 license](../../LICENSE); that license's trademark terms still apply.

Final banner prompt:

> Create a premium open-source developer-tool brand banner for INSTRILO, a product by nimeshbuilds that turns product guidance into owned, testable AI agents. Landscape wide 3:1 composition suitable for a GitHub README header and social cover, high resolution.
>
> Design: sophisticated Swiss editorial meets tactile paper engineering. Quiet warm ivory #F6F5F1 background, deep forest green #244E3A typography and shadows, luminous pale chartreuse #DCEB92 accents, subtle sage gray. The left 55% has beautifully set very large precise wordmark text "Instrilo", with small uppercase "BY NIMESHBUILDS" above it, and tagline beneath exactly "Build with intent. Ship with evidence." One readable line, modest size. Wide margins. No other text.
>
> On the right: a striking architectural sculpture made from three cream paper instruction cards that transition through a folded green ribbon into a precise chartreuse check mark, as if a specification has become a verified runnable agent. Restrained fine grid and tiny geometric nodes, very subtle. A single impossible-but-elegant paper fold gives depth, sophisticated soft natural shadows. Strong simple silhouette, visually balanced with typography. No robots, brains, mascots, generic AI sparkles, gradients, glows, circuit-board cliché, dense text, dashboard screenshot, or stock imagery. Craft-quality design for a serious open-source product. Keep all meaningful content in central 80% and generous whitespace.

## Compatibility

The product was developed under the working name Agent Studio. The first public release uses Instrilo throughout its UI and documentation while retaining `nb-agent` as a CLI alias, `agent-studio.yaml` as the manifest filename, `NB_AGENT_PYTHON` as the interpreter setting, and existing local project storage. Renaming a product should not strand its existing projects.
