# Changelog

## [0.1.30](https://github.com/Oppulence-Engineering/Desktop-Assistant/compare/v0.1.29...v0.1.30) (2026-08-07)


### Features

* **mailbox:** stop discarding the departure signal in bounces and autoreplies ([311b0d9](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/311b0d93b8a4f8a61e0086fe7818db9a0d7980a3))
* promote develop to main (cloud research, Starter tier) ([#222](https://github.com/Oppulence-Engineering/Desktop-Assistant/issues/222)) ([c36539a](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/c36539ab94440ba7b105a4ebb376c27522db45f0))
* **relationships:** expose person deletion, and make the departure signal do something ([5d4d5a6](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/5d4d5a6c9f9f8cf60c2e21c31b380f6bc93694a3))
* **relationships:** person deletion, departure signals, and a Research Mode RFC ([00b6811](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/00b6811a3db596608e222fe4b154bf161f254a1d))


### Bug Fixes

* **privacy:** stop the privacy receipt describing a flag nothing writes ([669933b](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/669933bc2bde10d504eab4a2b29ea213d02c7eb2))
* unblock background LLM work, and make settings mean what they say ([#214](https://github.com/Oppulence-Engineering/Desktop-Assistant/issues/214)) ([89cb072](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/89cb072dd514b53465540f17ccbff880d2bef2da))
* unblock background LLM work, and make settings mean what they say ([#215](https://github.com/Oppulence-Engineering/Desktop-Assistant/issues/215)) ([f94ab73](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/f94ab7344757d26223dec7782e94fd6adbd47c72))

## [0.1.29](https://github.com/Oppulence-Engineering/Desktop-Assistant/compare/v0.1.28...v0.1.29) (2026-08-06)


### Bug Fixes

* **llm:** route every chat model through OpenRouter ([#212](https://github.com/Oppulence-Engineering/Desktop-Assistant/issues/212)) ([c032b32](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/c032b32fe7453c564aa58eacefa779c812b5fd15))

## [0.1.28](https://github.com/Oppulence-Engineering/Desktop-Assistant/compare/v0.1.27...v0.1.28) (2026-08-06)


### Bug Fixes

* Google scope contract, dev deep-link hijack, and cheaper model defaults ([#209](https://github.com/Oppulence-Engineering/Desktop-Assistant/issues/209)) ([eb6f6a5](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/eb6f6a58380554aee5a5e05458c59154d91254d5))

## [0.1.27](https://github.com/Oppulence-Engineering/Desktop-Assistant/compare/v0.1.26...v0.1.27) (2026-08-05)


### Bug Fixes

* **gmail:** mailbox sync and Google write scopes ([#204](https://github.com/Oppulence-Engineering/Desktop-Assistant/issues/204)) ([3832c8c](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/3832c8c46ea288616c008ee68565f81994b6a4dc))

## [0.1.26](https://github.com/Oppulence-Engineering/Desktop-Assistant/compare/v0.1.25...v0.1.26) (2026-08-05)


### Features

* **desktop:** in-app update prompt ([#201](https://github.com/Oppulence-Engineering/Desktop-Assistant/issues/201)) ([c4e3da4](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/c4e3da4a2f21c8c5df706051f5c683a9aa659511))

## [0.1.25](https://github.com/Oppulence-Engineering/Desktop-Assistant/compare/v0.1.24...v0.1.25) (2026-08-05)


### Features

* Google connect fix and Next.js 16.3 migration ([#199](https://github.com/Oppulence-Engineering/Desktop-Assistant/issues/199)) ([daf26b3](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/daf26b3ec022a9dc50a50855a58304ebb3aedc8a))


### Bug Fixes

* honest sign-in errors and a manual build that cannot ship unsigned ([#195](https://github.com/Oppulence-Engineering/Desktop-Assistant/issues/195)) ([dc75a09](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/dc75a09cd41f2ce36b40ec208e8e1a0569f92d93))

## [0.1.24](https://github.com/Oppulence-Engineering/Desktop-Assistant/compare/v0.1.23...v0.1.24) (2026-08-05)


### Features

* canonical person, and relationship evidence from meetings and email ([0268364](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/02683643df29e6262353374b6ca215cffe8d6838))
* **desktop:** add guided product tour ([a7e50e6](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/a7e50e63f674d50f768fbb75bed1d275e37565e8))
* **desktop:** add guided product tour ([9eb90d8](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/9eb90d8862c3e9d102ba73cb9fe6b72671a967e4))
* **x:** publish relationship evidence from meetings and email ([fea9179](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/fea917903ab546c05104c1eabe8bc2800dd332f5))


### Bug Fixes

* **desktop:** stop the collapsed sidebar spilling over the content header ([f5d1479](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/f5d14798acf0b6209296546a3a251ba5762cd72f))
* **meetings:** correct language claims Parakeet cannot keep ([8c3ddfb](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/8c3ddfb136e653e1d2675bf1120f08099cdce50d))
* **meetings:** four defects found by adversarial review of the note path work ([dd589f6](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/dd589f61482a58a935f34d77c9964430d20972b9))
* **meetings:** stop a same-titled meeting overwriting an earlier one's note ([e26ea55](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/e26ea554c71c0c9f50ede836344f63fbe0094102))
* **meetings:** transcribe in the language spoken, and stop deleting user notes ([d6b45cc](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/d6b45cc34044937aef97a231283fd7607b4c23f7))
* **meetings:** transcribe in the language spoken, and stop deleting user notes ([06b356c](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/06b356cf3f79e114ae15c5cf89b0eba52b2d4936))


### Documentation

* **meetings:** record the note-ownership contract, and cover transcriptionOrder ([2835410](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/28354106338b332ff7f4fd07aecfc2196b27d0fe))

## [0.1.23](https://github.com/Oppulence-Engineering/Desktop-Assistant/compare/v0.1.22...v0.1.23) (2026-08-01)


### Features

* add conversation follow-through intelligence ([23d0518](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/23d0518c7ddaa7ffcb9a737e66b5904bd501f66e))
* add cross-channel relationship intelligence learning loop ([b16713e](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/b16713e9a9e5c9c78b2009f1a034579691ff9214))
* connect transcription to relationship evidence ([#172](https://github.com/Oppulence-Engineering/Desktop-Assistant/issues/172)) ([f7ec822](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/f7ec82292250f1621a4657955d00bc67c8a1d75e))
* enable production conversation intelligence integrations ([#175](https://github.com/Oppulence-Engineering/Desktop-Assistant/issues/175)) ([861b580](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/861b58047a2fb078c6d964ca8f13f09c7cdb9d98))
* implement RFC 037 conversation intelligence and follow-through ([#174](https://github.com/Oppulence-Engineering/Desktop-Assistant/issues/174)) ([cbc6eba](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/cbc6eba2ad2ffaf1376707f887583e0a294aaeef))

## [0.1.22](https://github.com/Oppulence-Engineering/Desktop-Assistant/compare/v0.1.21...v0.1.22) (2026-07-29)


### Features

* build relationship intelligence foundation ([fb16aed](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/fb16aeda554e00e8404f3e72e6f4fce87a3d7db3))

## [0.1.21](https://github.com/Oppulence-Engineering/Desktop-Assistant/compare/v0.1.20...v0.1.21) (2026-07-21)


### Features

* **mailbox:** add core data model, ids, capabilities, and error taxonomy ([802dade](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/802dadeb45092396991d86c2ebeca3c89077f1bd))
* **mailbox:** add local store and sync reliability layer ([cbada95](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/cbada957e8734ad5b20449863c3685fa3d437d22))
* **mailbox:** add MailboxService facade, public barrel, and module docs ([713d510](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/713d510a7dd3cd271e0c30bbc0481c4619e7cac3))
* **mailbox:** add model-backed matcher, classifier, drafts, and evals ([1044859](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/1044859b483992e2d67b549756ce3a95eda8ce74))
* **mailbox:** add privacy guards for model calls and logging ([a526443](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/a52644355cc088fc47e30e0da164344031adb663))
* **mailbox:** add provider contract and Gmail adapter over existing sync ([7a4197a](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/7a4197ab1c1663868a6488b92e35d872a8ac3771))
* **mailbox:** add reply tracking state machine and local drafts ([aca9f12](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/aca9f126164d858fc7b04a4037376955feea5be3))
* **mailbox:** add rules engine with policy gate, audit log, and preview ([6a1f2d4](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/6a1f2d4655c89daa3f08eee2c740d0a1dad4d5ef))
* **mailbox:** provider-neutral mailbox foundation, rules engine, and reply tracking ([56acdf5](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/56acdf57e20c3cff6272ea1e73a16fb178ecb4aa))
* **main:** wire provider-neutral mailbox IPC handlers ([358b06c](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/358b06cd4ad1f1e4668c0b93cc4e1548d4af35ea))
* **shared:** add provider-neutral mailbox blocks and IPC schemas ([6518796](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/6518796df100c91aab61e11286fd13e4a218abdb))
* unified Cossistant-inspired design language across console and desktop ([11b0054](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/11b005429d2a6e4195b864c1a2ee02a9fd43c1b3))
* **x:** adopt the console design language in the desktop shell ([25f408c](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/25f408c5d2af6e349787e5dccf49e6f623919ccb))


### Refactors

* **x:** back the desktop icon facade with phosphor ([0249a85](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/0249a85a5f1d32e322cc2ae60c0b250b41f78686))

## [0.1.20](https://github.com/Oppulence-Engineering/Desktop-Assistant/compare/v0.1.19...v0.1.20) (2026-07-07)


### Features

* add dogfood background task runtime ([18477e4](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/18477e4fab3abf4e8195ded37bed3b8776693330))
* add rowboat website and refresh onboarding ([587126b](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/587126b2bbffac2654a1c8d47a783b1291ea19b2))
* add WorkOS auth to rowboat web ([691e7c2](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/691e7c27982314197f0caf1dea9462249351e459))


### Bug Fixes

* address remaining PR review threads ([696f162](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/696f162b0ce8fbcce277eea6add841ef33980e3e))
* **apps/x:** resolve 56 logistical/UX defects from full feature audit ([a040056](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/a040056bed9f454769627b7b4530f8b82d2bd5b3))
* detect shell process substitutions ([2a4dd36](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/2a4dd368bb58591a7b827dae9987d51786637347))

## [0.1.19](https://github.com/Oppulence-Engineering/Desktop-Assistant/compare/v0.1.18...v0.1.19) (2026-06-26)


### Bug Fixes

* **desktop:** refresh oauth callback page ([23194b6](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/23194b691880094df209fba19bd1089627abc4ec))

## [0.1.18](https://github.com/Oppulence-Engineering/Desktop-Assistant/compare/v0.1.17...v0.1.18) (2026-06-26)


### Bug Fixes

* **desktop:** normalize retired api host ([bf25382](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/bf2538216a9b61901f2299c25bbd1b6f5ae50ae6))

## [0.1.17](https://github.com/Oppulence-Engineering/Desktop-Assistant/compare/v0.1.16...v0.1.17) (2026-06-25)


### Features

* **apps/x:** implement RFC 017 on-device meeting diarization ([3b8c398](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/3b8c398233de62cb0423c904cd6e7360c1dd7d10))
* **apps/x:** implement RFC 021 local semantic memory index + app surfaces ([5e318b4](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/5e318b45c39e1b1ee1c088fe87d6a88b5efe805d))
* **apps/x:** surface semantic memory in the UI (settings, related notes, sources, ⌘K) ([34feb52](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/34feb52a2c6247002b9656298c2717be8ef9b4f7))


### Bug Fixes

* **apps/x:** wire related notes toolbar action ([82b2ab5](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/82b2ab5babda14eba38164ab64fb651015a5b694))

## [0.1.16](https://github.com/Oppulence-Engineering/Desktop-Assistant/compare/v0.1.15...v0.1.16) (2026-06-14)


### Features

* robust WorkOS token refresh (desktop state machine + idempotent broker) ([626ecf4](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/626ecf44bad1e67e31b0d8af7d8bfa88d8e7e22a))
* **x:** classify WorkOS refresh failures like the Google path ([0aa7a4c](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/0aa7a4c3e88f3c826938b4cbd12b8897a97a7bcf))
* **x:** refresh state machine for the WorkOS session ([d3029bc](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/d3029bc3816c1e4a0b7db227afec6c737c25f50a))


### Bug Fixes

* dogfooding findings — tenant scoping, cron scheduling, desktop UX ([953ed5a](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/953ed5a6829292f94dbcc6db0ae61a0c21cd091a))
* harden transcription edge cases ([2d9eabf](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/2d9eabfb1d90aceb34be70bdc980848963859394))
* stabilize local meeting transcription and notes ([8fd97cd](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/8fd97cda45cb07fe38ecd9d8985a003629d76833))
* **x:** carry typed description into manual task config ([97966c0](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/97966c03fcd8f03535e5527f32afa85f67219d07))
* **x:** don't fire never-run cron tasks outside their schedule ([297de5b](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/297de5b324804d4e9357352c0ccdb177ffba1ae7))
* **x:** focus new untitled notes and surface recording start failures ([6fce28a](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/6fce28afede14f4ced383a30d726a43ce40755d3))
* **x:** keep atomic-write temp files out of listings and watch events ([c240cd1](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/c240cd14a0ab4462df82a2663489091c5ff66beb))
* **x:** quiesce cloud sync while the WorkOS session is unavailable ([f3f78e8](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/f3f78e80e050fcaa3abc429cd00c7b521fe3d410))
* **x:** render actionable chat errors instead of 'name: AI_RetryError' ([8db48fe](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/8db48fe9b805c8412d8b8f627d709bc734e75a70))
* **x:** serialize and crash-harden oauth.json writes ([6c884ff](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/6c884ff4c33b2407b8051758e6ce698ba01f679d))

## [0.1.15](https://github.com/Oppulence-Engineering/Desktop-Assistant/compare/v0.1.14...v0.1.15) (2026-06-11)


### Features

* close RFC 006 deferred items — event provenance, OS notifications, quit reminder ([c639aac](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/c639aaca95298f8ec4b4e9e22ecb8db118551f22))
* RFC 006 — desktop as cloud workflow control plane ([cff267e](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/cff267e0edeebd256118ae3c8026ffcaac4403e4))
* **x:** add cloud schedule-state types and IPC contracts ([30dcbc6](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/30dcbc6c9d1a00621a8e099ccccd206580cdc898))
* **x:** add getCloudScheduleState core client and IPC handler ([6733e26](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/6733e269486c9d1b2d20f66667213bbf19eecd0e))
* **x:** add notification preferences config and settings toggle ([212fa71](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/212fa718f2e7801f674098f0ccad7c8d2b99016e))
* **x:** fire opt-in OS notification for missed cloud runs ([db6afd4](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/db6afd43924c73f80b2599182fd5354b5948ba85))
* **x:** remind about pausing desktop schedules on quit ([df55082](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/df5508234e42a7bf9d5e002cd91dcce1844eba50))
* **x:** render cloud schedule state, ownership labels, and runs filters ([68eb741](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/68eb741496572c1350fada66822f8594d5b8878b))
* **x:** show run provenance in the cloud transcript ([7d44535](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/7d445351d09808781d2509e07b74948d8f36173f))
* **x:** surface cloud runs completed while the app was closed ([6cd7bef](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/6cd7beffcf8d56535dc336f7ca4894958a03313e))


### Bug Fixes

* offline-runs toast listener must live at the app root ([bb43b87](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/bb43b87ce10de0109fd92860a8a4c9392c42a32f))
* **x:** move the offline-runs toast listener to the app root ([6201e65](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/6201e65e07b6210b1793a096b7048991a23d0077))
* **x:** stop the desktop firing api-target timed triggers ([77e0922](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/77e09228054cf08cf9882ad28fc004a64a3e29ef))

## [0.1.14](https://github.com/Oppulence-Engineering/Desktop-Assistant/compare/v0.1.13...v0.1.14) (2026-06-11)


### Features

* RFC 005 — Temporal Schedule integration for exact-cron cloud tasks ([651d316](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/651d316ba67257b5b60e87e08c18863d24a04d8f))
* **x:** mirror scheduleSyncState on background-task shared types ([1b819e2](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/1b819e236795df289d18c1e1ae6bfca82711dbde))


### Bug Fixes

* **rowboat-api:** clamp occurrence skew allowance and scope retry bypass ([936d490](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/936d49025fe92f4533a64b58ad7d52d6345d8c66))
* **x:** retry cloud task delete on revision conflict ([4af0926](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/4af0926a2f87cc9e4e7782b73d2297b9731dde6b))

## [0.1.13](https://github.com/Oppulence-Engineering/Desktop-Assistant/compare/v0.1.12...v0.1.13) (2026-06-10)


### Features

* **desktop:** full-page onboarding + Solomon AI logo; fix stale smoke assertions ([202465a](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/202465ac651b4621bd68af14098bac450b6daccf))
* **desktop:** further polish MCP, Security, Code Mode, and Help settings ([9bc23fd](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/9bc23fd38f05b3e6a2c61a6448b5d00cdccd101c))
* **desktop:** local on-device transcription engine — P1 (RFC 009) ([db11172](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/db111726da165d39134f4bf5020e21e4bc459956))
* **desktop:** meeting-mode local streaming transcription — P2 (RFC 009) ([1600be3](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/1600be3a9db6b20335d932a3116fcb60fb77b5b1))
* **desktop:** polish the Note Tagging settings tab ([d941323](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/d94132307ee57e562446cf39200c557290ac9f13))
* **desktop:** polish the Transcription settings tab ([133ca4d](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/133ca4d7de0b0ca5a020b9c482f819f232e5765b))
* **desktop:** settings rework — grouped nav, motion, JSON tabs → forms ([1b710bb](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/1b710bb37b511b388dd063bc183d69fde8470e0d))
* **desktop:** visual previews for the Appearance settings tab ([be6b709](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/be6b70922fad9c5f93593d017778a0911a27f58f))
* in-app feedback via Plain.com ([#58](https://github.com/Oppulence-Engineering/Desktop-Assistant/issues/58)) ([81fb201](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/81fb20187bf6905d016ef2644ca46d220e88b7d3))
* **rowboat-api:** free meeting-minutes quota + desktop fallback — RFC 009 WP 2.2 ([443b630](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/443b63072af350c92c336b04d758aee32fa40627))
* **rowboat-api:** RFC 004 cloud agent runtime — LLM-backed, tool-scoped background task execution ([2cfc6a8](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/2cfc6a81d8603c0bbc0b85a45b0f25d49d371c1b))
* **x:** Slack workspace connect — deep link, claim, IPC surface ([a527621](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/a52762189960b2059e929c2603ac002d44623a1d))
* **x:** Slack workspace connect flow — deep link, claim, IPC ([11cbf2b](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/11cbf2b44bb63eb563b277bc4cb2d0338f467f7b))


### Bug Fixes

* address all bugs ([a811db3](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/a811db398b55775d5a0f397c8cb2b180080a67df))
* **desktop:** lint cleanups in transcription settings + meeting hook ([8442617](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/84426175710ae1bfd477370ad901540dcbed2ec9))
* **desktop:** send Idempotency-Key from the LLM gateway client ([c2c73ec](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/c2c73ec9bb819cb9cbc9b71d48daf60c86d7ce9b))
* **rfc-009:** address code-review findings (correctness + quota hardening) ([f5b9611](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/f5b9611557a1fb3bb6197c5a018b3d2092ac264c))
* **rfc-009:** fix regressions surfaced reviewing the prior fix commit ([739820c](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/739820cc879d2d4d487416f8f19b9e2997ad9ee7))
* **rfc-009:** resolve code-review findings (TTS, model selection, robustness) ([9903a28](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/9903a28493db9c492481206a5a9d780d0ddf183b))
* **x:** block data: and vbscript: in browser IPC URL validators ([b1ba83d](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/b1ba83d9381612cfb68c46f517791413d4e306af))
* **x:** block data: and vbscript: schemes in embedded browser nav ([a390d57](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/a390d575ffecbdb9b0be123cd82abbd91773256d))


### Documentation

* **charts,x,rfc:** cloud runtime env defaults + vocabulary mirror; RFC 004 complete ([73e388d](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/73e388d5c6a4516afca8d32257c87b779c27a5cf))


### Refactors

* **desktop:** extract Models settings + polish remaining settings tabs ([98c5e90](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/98c5e9047df497ad56ab670bdf9dce244670b730))

## [0.1.12](https://github.com/Oppulence-Engineering/Desktop-Assistant/compare/v0.1.11...v0.1.12) (2026-06-07)


### Bug Fixes

* **x:** add volumeName to DMG maker to fix macOS build ([308b018](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/308b0188adb55b1cde8165dfe147f4fe5b1791c8))
* **x:** set short DMG volume title ([f018d78](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/f018d780c35b3cec93d4af796418dcf2e85ed0bc))
* **x:** skip notarization when Apple credentials are missing or empty ([df36f93](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/df36f937269193d0f49226194888872adc5e10d6))

## [0.1.11](https://github.com/Oppulence-Engineering/Desktop-Assistant/compare/v0.1.10...v0.1.11) (2026-06-06)


### Features

* **x:** ElevenLabs UI rework + engineering quality gates ([#40](https://github.com/Oppulence-Engineering/Desktop-Assistant/issues/40)) ([27cf9b5](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/27cf9b5b9db1c8739c0ca1844606d6e3acc95133))


### Bug Fixes

* address code mode review feedback ([a5f10f6](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/a5f10f63ced50bea51d28f2485632e7705ddcddb))

## [0.1.10](https://github.com/Oppulence-Engineering/Desktop-Assistant/compare/v0.1.9...v0.1.10) (2026-06-06)


### Features

* rebrand desktop assistant to Solomon AI ([775c9ac](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/775c9ac9e29387c4fb6ea8dd92328bffbe4c806b))

## [0.1.9](https://github.com/Oppulence-Engineering/Desktop-Assistant/compare/v0.1.8...v0.1.9) (2026-06-06)


### Features

* **background-tasks:** make API-native cloud runs operable, observable & verifiable ([a731abb](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/a731abb64c7c77bb54e13c24db05e4abe03f544e))
* redesign web search & tool-call cards (rolling reveal, shared surface, action summaries) ([#579](https://github.com/Oppulence-Engineering/Desktop-Assistant/issues/579)) ([b89b912](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/b89b91258e4fdca66251e1222cc90784c81f96d5))
* render and edit docx files in-app ([#589](https://github.com/Oppulence-Engineering/Desktop-Assistant/issues/589)) ([5368751](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/5368751f61e1b61b56ea0ef297276e929bad38c8))
* rowboat-api backend with WorkOS-direct auth + Google OAuth broker ([f9ae9e4](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/f9ae9e4207565a2f2ba05f9c28ba709fadc92c2e))
* rowboat-api backend with WorkOS-direct auth + Google OAuth broker ([89b0cc8](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/89b0cc8cc53714159f1da51d30eedb3d3a17e37d))


### Bug Fixes

* notes — in-note section links, deep-note wiki resolution, file links ([#571](https://github.com/Oppulence-Engineering/Desktop-Assistant/issues/571)) ([a59c42e](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/a59c42e22bb47175077d2fbef06456a693ee7f5b))
* scope chat work directory per-run instead of globally ([#578](https://github.com/Oppulence-Engineering/Desktop-Assistant/issues/578)) ([d981fa9](https://github.com/Oppulence-Engineering/Desktop-Assistant/commit/d981fa9206a21ac9aa83ae21ac4b1ede8eba0eb2))

## [0.1.8](https://github.com/Oppulence-Engineering/rowboat/compare/v0.1.7...v0.1.8) (2026-05-21)


### Performance

* improve desktop app performance hot paths ([e70895b](https://github.com/Oppulence-Engineering/rowboat/commit/e70895b9d4a3d9974812b974a66e993418da6e4d))

## [0.1.7](https://github.com/Oppulence-Engineering/rowboat/compare/v0.1.6...v0.1.7) (2026-05-20)


### Features

* **x:** capture native crashes via Electron crashReporter ([#22](https://github.com/Oppulence-Engineering/rowboat/issues/22)) ([79121d1](https://github.com/Oppulence-Engineering/rowboat/commit/79121d18eda4bde6a790dcf7d4dbb196bacdafb5))

## [0.1.6](https://github.com/Oppulence-Engineering/rowboat/compare/v0.1.5...v0.1.6) (2026-05-19)


### Bug Fixes

* **x:** remove stray 'undefined' prefix from posthog.ts ([#16](https://github.com/Oppulence-Engineering/rowboat/issues/16)) ([4011057](https://github.com/Oppulence-Engineering/rowboat/commit/40110579a7f7d48f1fcb6d0c81e973b62f157220))

## [0.1.5](https://github.com/Oppulence-Engineering/rowboat/compare/v0.1.4...v0.1.5) (2026-05-19)


### Features

* **x:** capture uncaught exceptions in posthog ([#14](https://github.com/Oppulence-Engineering/rowboat/issues/14)) ([af6f20d](https://github.com/Oppulence-Engineering/rowboat/commit/af6f20d703f51d0fc1908341be6fdb5180863a3f))

## [0.1.4](https://github.com/Oppulence-Engineering/rowboat/compare/v0.1.3...v0.1.4) (2026-05-19)


### Bug Fixes

* **x:** point auto-updater to fork repository ([#12](https://github.com/Oppulence-Engineering/rowboat/issues/12)) ([6e43dfe](https://github.com/Oppulence-Engineering/rowboat/commit/6e43dfec7436f569cccd7384a3447e696e22093c))

## [0.1.3](https://github.com/Oppulence-Engineering/rowboat/compare/v0.1.2...v0.1.3) (2026-05-18)


### Documentation

* **forge:** document why releases are stable, not pre-release ([#8](https://github.com/Oppulence-Engineering/rowboat/issues/8)) ([937b418](https://github.com/Oppulence-Engineering/rowboat/commit/937b418253509d2d3d6da94bdb8a914ef2e98d73))

## [0.1.2](https://github.com/Oppulence-Engineering/rowboat/compare/v0.1.1...v0.1.2) (2026-05-18)


### Bug Fixes

* publish releases as stable, not pre-release ([a1ec3d8](https://github.com/Oppulence-Engineering/rowboat/commit/a1ec3d87c90f04cf2a54ab3fa36d03f239849b1a))
* publish releases as stable, not pre-release ([06549c9](https://github.com/Oppulence-Engineering/rowboat/commit/06549c9907a3373af7c3a21e74770dc379a37c09))

## [0.1.1](https://github.com/Oppulence-Engineering/rowboat/compare/v0.1.0...v0.1.1) (2026-05-17)


### Features

* add back link command handling in markdown editor with keyboard navigation support ([4e05a08](https://github.com/Oppulence-Engineering/rowboat/commit/4e05a08bd0920b8a973b81c531029cd9d307465f))
* add background agents with scheduling support ([c447a42](https://github.com/Oppulence-Engineering/rowboat/commit/c447a42d070d15f8aef63dafd69da95bc6e92377))
* add error, empty, and oversize states to html viewer ([754561d](https://github.com/Oppulence-Engineering/rowboat/commit/754561d893f1eacf8b1915401729047d6b97866d))
* add interactive file path cards in chat UI ([0de9589](https://github.com/Oppulence-Engineering/rowboat/commit/0de9589a7dba6ffc39faa2d060e33828023c6f96))
* add parseFile builtin tool for PDF, Excel, CSV, Word extraction ([4151c29](https://github.com/Oppulence-Engineering/rowboat/commit/4151c296bd8934010a43e54b59db94eb8946aee2))
* add remove chat button and logic ([5036937](https://github.com/Oppulence-Engineering/rowboat/commit/503693775a17bbbd6c44e2de10e0cc98911dd3bc))
* add ScrollPositionPreserver component to manage scroll engagement in conversations. ([d903a8c](https://github.com/Oppulence-Engineering/rowboat/commit/d903a8cae3d172658eb0e3b5591b6e5983ed596c))
* add search button to FixedSidebarToggle and integrate onOpenSearch prop ([73da27e](https://github.com/Oppulence-Engineering/rowboat/commit/73da27eec6ca4631b5f7cb29be876b01f1bbaa09))
* add stop execution with hybrid graceful/force abort ([a3e681a](https://github.com/Oppulence-Engineering/rowboat/commit/a3e681a7c40ca311e145fded0b692b294a9a0e32))
* add syncing update for graph building on the UI ([eefc6a9](https://github.com/Oppulence-Engineering/rowboat/commit/eefc6a9700128e715b448c3a91bcc45a9180a7d1))
* auto-initialize config files on Electron app startup ([f5cc803](https://github.com/Oppulence-Engineering/rowboat/commit/f5cc8033405d535fedc3d08d288425e62e95b93f))
* **integrations:** hide legacy integration tools from copilot whilst the API key is not set in isSignedIn is false ([50df9ed](https://github.com/Oppulence-Engineering/rowboat/commit/50df9ed1785067c15032c955e9dc6d0701948651))
* enhance knowledge tree navigation and visibility ([e8d8332](https://github.com/Oppulence-Engineering/rowboat/commit/e8d8332e34c1979dc0ad2a9336505e9408fdc6c5))
* enhance markdown editor to preserve blank lines and improve markdown processing ([4c333f2](https://github.com/Oppulence-Engineering/rowboat/commit/4c333f241ff69c2a57734cff974cacff3c5e7f72))
* enhance navigation in the app with back/forward buttons and view state management ([14dab23](https://github.com/Oppulence-Engineering/rowboat/commit/14dab23670fbb252b324eb29d3c315ca41685c24))
* enhance PATH resolution for packaged Electron apps on macOS/Linux ([9e28c47](https://github.com/Oppulence-Engineering/rowboat/commit/9e28c47f30590c43734af0bed7e0c26c260aa013))
* enhance presentation skill with templates, validation, and theming ([3f23191](https://github.com/Oppulence-Engineering/rowboat/commit/3f23191ecd93e9ec35345f88129d3e854126a442))
* enhance sidebar behavior with collapsible left pane and optimized chat sidebar transitions ([1cad68e](https://github.com/Oppulence-Engineering/rowboat/commit/1cad68e60fde22e14601fbc13d1b50433fef80af))
* enhance SyncStatusBar with popover for service logs and increase event limit ([2bb27e4](https://github.com/Oppulence-Engineering/rowboat/commit/2bb27e477fdf26e91812ff09c07e72127c74b975))
* extract presentation generator into executable code with builtin tool ([e6c6571](https://github.com/Oppulence-Engineering/rowboat/commit/e6c6571b07cb264930a288c3834cae134a99386e))
* Gmail-style email block with inbox container layout ([#531](https://github.com/Oppulence-Engineering/rowboat/issues/531)) ([0e3d058](https://github.com/Oppulence-Engineering/rowboat/commit/0e3d058c2959034cd84de9cd7382e9bf2f5b678a))
* group consecutive tool calls into collapsible summary ([9ed54e2](https://github.com/Oppulence-Engineering/rowboat/commit/9ed54e2b94656d0ebd0166b828b8695187aeb5d0))
* group consecutive tool calls into collapsible summary ([4ca03da](https://github.com/Oppulence-Engineering/rowboat/commit/4ca03daa4cf51d4ec06f9073e515baaf0c2356dc))
* implement delete confirmation dialog ([c75ab4e](https://github.com/Oppulence-Engineering/rowboat/commit/c75ab4eba79b0fe9f9ed5685f0c59b7be0b49c10))
* implement graph tab functionality and enhance tab management ([f61404c](https://github.com/Oppulence-Engineering/rowboat/commit/f61404cbcde3155238cae66642dfcd1fe3e49770))
* implement model settings UI in settings dialog ([464f257](https://github.com/Oppulence-Engineering/rowboat/commit/464f257271c70920895214cf30339c638004ffad))
* implement preferred default models for LLM providers in onboarding modal ([92d324a](https://github.com/Oppulence-Engineering/rowboat/commit/92d324a84edfebb23c009d8ad8d394dfe72fa096))
* implement tab indentation support in markdown editor and enhance file handling in app ([27c1142](https://github.com/Oppulence-Engineering/rowboat/commit/27c1142bb5e0f174815c139db1badc2a31e73592))
* integrate Supabase OAuth with OIDC discovery for authentication ([bbe82c1](https://github.com/Oppulence-Engineering/rowboat/commit/bbe82c124d18d855a5341c571fe9db5c20370f63))
* live notes — single objective per note replaces multi-track model ([dabca3d](https://github.com/Oppulence-Engineering/rowboat/commit/dabca3da1948f76634c5499c0723a9b73fd0618d))
* make sure graph view opens in maximised pane ([fe689c7](https://github.com/Oppulence-Engineering/rowboat/commit/fe689c705fc0bcb0460baec39784bf5d64e37b23))
* minimal Today.md UI polish - no emoji headings, better track chip ([#528](https://github.com/Oppulence-Engineering/rowboat/issues/528)) ([0bb58e5](https://github.com/Oppulence-Engineering/rowboat/commit/0bb58e55ac6f8f91927298f96e0719579a89bed1))
* move gmail sync to managed OAuth and remove calendar sync ([d12150f](https://github.com/Oppulence-Engineering/rowboat/commit/d12150f1bf8d922b432b483664668d0f899330f7))
* native desktop notifications + rowboat:// deep links ([1c2b2ac](https://github.com/Oppulence-Engineering/rowboat/commit/1c2b2ac1fc8d00fc7d4f09077a96b9e539e1b3a0))
* native google sign-in for signed-in users ([d4850da](https://github.com/Oppulence-Engineering/rowboat/commit/d4850dace70171afaf2b47389216b9aa919db23e))
* **oauth:** enhance Rowboat sign-in process to prevent duplicate users ([#489](https://github.com/Oppulence-Engineering/rowboat/issues/489)) ([2653f61](https://github.com/Oppulence-Engineering/rowboat/commit/2653f6170de750100bb1c6c75121996607349c9e))
* **oauth:** switch Google OAuth from PKCE to authorization code flow with client secret ([50bce6c](https://github.com/Oppulence-Engineering/rowboat/commit/50bce6c1d676c4ab7e9005ab8438858bf970ae8b))
* **oauth:** switch Google OAuth from PKCE to authorization code flow… ([41bbec6](https://github.com/Oppulence-Engineering/rowboat/commit/41bbec6296595fb03f4d5c3a897cfff347cd1576))
* redesign live-note sidebar with Objective / Last run / Details tabs ([ab23cb4](https://github.com/Oppulence-Engineering/rowboat/commit/ab23cb4543908a7f0a4f1572c86cfdbb81abfb32))
* render audio files with native player ([a4cd6ab](https://github.com/Oppulence-Engineering/rowboat/commit/a4cd6abb3a20d165933a01b00be9ee1c089720c6))
* render html files in knowledge view via sandboxed iframe ([9014c79](https://github.com/Oppulence-Engineering/rowboat/commit/9014c79f2c853c9e9fed6934ff1329d7eaeabc5d))
* render html, image, video, audio, and pdf in knowledge view ([0bf7a55](https://github.com/Oppulence-Engineering/rowboat/commit/0bf7a5561181794228e5f4360e51ea04b69af2f5))
* render pdf files via chromium pdfium plugin ([b351943](https://github.com/Oppulence-Engineering/rowboat/commit/b3519433ebbcc218d9dbb5372dbf53da1a9d7d46))
* render video files with native controls and seeking ([b24113b](https://github.com/Oppulence-Engineering/rowboat/commit/b24113b78e6dac5ebe63e461bc064490a6faf73e))
* rewrite presentation skill to give agent full code freedom ([9cd7d11](https://github.com/Oppulence-Engineering/rowboat/commit/9cd7d11969807f9378065e1e819c2463842a9942))
* serve workspace files via app:// protocol and add image viewer ([0d9cf71](https://github.com/Oppulence-Engineering/rowboat/commit/0d9cf71947e009ad4ff384e7e98b94a8649e17ce))
* show unsupported file panel instead of raw bytes ([c5ee363](https://github.com/Oppulence-Engineering/rowboat/commit/c5ee36312233648a9d37951ff58576dd7f6b9f6c))
* **sidebar:** implement auto-collapse functionality and refine sidebar toggle logic ([79a21c7](https://github.com/Oppulence-Engineering/rowboat/commit/79a21c715ee8faf5d8bd8bb82dc03c6b6c0a2a59))
* simplify LLM config and onboarding ([10f94ce](https://github.com/Oppulence-Engineering/rowboat/commit/10f94ce67e2a1b01771cb5577ee741d2875065b2))
* slack integration with managed connectors ([aa2a830](https://github.com/Oppulence-Engineering/rowboat/commit/aa2a830f237ae67b53ed30c8f5b6b38ae9590c64))
* **suggested-topics:** populate and integrate suggested topics ([eaab438](https://github.com/Oppulence-Engineering/rowboat/commit/eaab438666e0e5e94d08d1ebe42cf2ac8658b64e))
* tracks — frontmatter directives, sidebar UI, multi-trigger ([eb6a7ac](https://github.com/Oppulence-Engineering/rowboat/commit/eb6a7ac4665a7281e24c1c0d38615cf06c850eb2))
* tracks — frontmatter directives, sidebar UI, multi-trigger ([db67575](https://github.com/Oppulence-Engineering/rowboat/commit/db6757514c15f9fe8510f7bb873abdef6edbcc6d))
* **ui:** add Suggested Topics feature ([e9cdd3f](https://github.com/Oppulence-Engineering/rowboat/commit/e9cdd3f6eb8fe854105b5e27fa78029030479dd6))
* **ui:** surface LLM stream errors in chat ([e1d50c6](https://github.com/Oppulence-Engineering/rowboat/commit/e1d50c62da4d467e6e3fe0dd74883b6d569b2b32))
* update chat and app UI with new maximize/minimize icons ([bf5f6f1](https://github.com/Oppulence-Engineering/rowboat/commit/bf5f6f16de69350e46534eb14007ec1bf10e1aef))
* voice notes with instant transcription and knowledge graph integration ([d7b84f8](https://github.com/Oppulence-Engineering/rowboat/commit/d7b84f87d0c8581166fee53d7b2694439677f14b))


### Bug Fixes

* adjust spacing in title bar ([0cfcc89](https://github.com/Oppulence-Engineering/rowboat/commit/0cfcc89edf11cfe697693075feb679aa25d796a8))
* broken thinking indicator ([b238089](https://github.com/Oppulence-Engineering/rowboat/commit/b238089e2dbd227adeb58215d92d5303cf9ce36c))
* chat sidebar buttons and sidebar collapse behaviour ([2efc80a](https://github.com/Oppulence-Engineering/rowboat/commit/2efc80a7e2f5c0f39a06ff6080043b5d7b36e785))
* clean up OAuth server when flow is abandoned or restarted ([7a59b28](https://github.com/Oppulence-Engineering/rowboat/commit/7a59b2865148be4dce50df3f89c0eec5451c4677))
* cmd+z behaviour on notes ([7253405](https://github.com/Oppulence-Engineering/rowboat/commit/72534052e00da1e7c88490bc92b8fd61646a78e1))
* context-aware folder/note creation in knowledge panel ([#538](https://github.com/Oppulence-Engineering/rowboat/issues/538)) ([4b7911c](https://github.com/Oppulence-Engineering/rowboat/commit/4b7911c8eae0d3af7958bb8f1eabafdaa2f84e06))
* duplicate navigation button ([0f051ea](https://github.com/Oppulence-Engineering/rowboat/commit/0f051ea4675030fbdf80da0095780d9dbfe522b2))
* empty note behaviour ([c76d089](https://github.com/Oppulence-Engineering/rowboat/commit/c76d08953d6b4318e35e58ee10a476b166ac4b24))
* **help-popover:** update Discord invite link to the new URL ([9c010da](https://github.com/Oppulence-Engineering/rowboat/commit/9c010dabd863c0978ced5fe8f299003fe9887c9f))
* made the chat input box same width as the text area ([64e7223](https://github.com/Oppulence-Engineering/rowboat/commit/64e7223cbb5e12f8b88acc081a81b7fa1e0eeeb9))
* **oauth:** full callback URL, Google clientId, refresh, and review follow-ups ([e1c6758](https://github.com/Oppulence-Engineering/rowboat/commit/e1c6758a3fb5a52d5784ddb3b4ddd6d5bad77789))
* **oauth:** preserve full callback URL for token exchange + persist Google Client ID ([d854b3f](https://github.com/Oppulence-Engineering/rowboat/commit/d854b3f4f0cb1ffd679595ed923ad4ceafa28f58))
* resolve file card paths for ~/.rowboat/ files and restrict filepath blocks to existing files ([a05e946](https://github.com/Oppulence-Engineering/rowboat/commit/a05e9468f36f3f95f215a25eec8254e378811449))
* resolve TS errors for unused fileContent state and missing JSX n… ([10995eb](https://github.com/Oppulence-Engineering/rowboat/commit/10995ebed69f56db899619b8636c8c14b5f9b6cb))
* resolve TS errors for unused fileContent state and missing JSX namespace ([8737605](https://github.com/Oppulence-Engineering/rowboat/commit/873760566675697fe2550931dda095c615dcf6c7))
* route Google reconnect through rowboat flow when signed in ([3b09296](https://github.com/Oppulence-Engineering/rowboat/commit/3b09296291c64a887eea4179cc34eb330c9951f4))
* search showing up for connected account ([de8b329](https://github.com/Oppulence-Engineering/rowboat/commit/de8b3291e43cce5bdbab4d37e0d4b62804e43a16))
* stabilize knowledge note loading and untitled title behavior ([e8a6664](https://github.com/Oppulence-Engineering/rowboat/commit/e8a666499aa3aec1a5829bd8b13331f4d1810fa7))
* stop Gmail sync from throwing "No refresh token is set" in rowboat mode ([acff502](https://github.com/Oppulence-Engineering/rowboat/commit/acff502f424635ec0b5ae4b56c46231913e36cbf))
* stop reordering cached paths to keep iframe state alive ([d9d936b](https://github.com/Oppulence-Engineering/rowboat/commit/d9d936b7e8976afd8674fc6fe1e5378b6cd0fe63))
* traffic light placeholder ([b905a19](https://github.com/Oppulence-Engineering/rowboat/commit/b905a197470f26905c16be53ffd41feaabf3c2ac))
* update anthropic model version in onboarding modal and settings dialog ([59d38b6](https://github.com/Oppulence-Engineering/rowboat/commit/59d38b684be59ffcd1a5e1847bc2a23ab3718b43))
* update button margin styles in title bar for consistent spacing ([fa528f1](https://github.com/Oppulence-Engineering/rowboat/commit/fa528f16e18bb38070195b42aff1f5243d1e6abf))
* update titlebar button configurations for better layout ([06444e5](https://github.com/Oppulence-Engineering/rowboat/commit/06444e5db209e23ab88d2d8cc2eefe48a1d8e886))
* update userId in executeAction to a static value and improve error logging ([f22087c](https://github.com/Oppulence-Engineering/rowboat/commit/f22087cbc3990c06bffbd576b6f85c72a5511a9c))


### Performance

* cache html content by mtime and size in lru of 20 ([ede98f5](https://github.com/Oppulence-Engineering/rowboat/commit/ede98f53787c8e82f20b8d83fda81a03338b610a))
* keep recent html and pdf viewers mounted to preserve state ([49a5027](https://github.com/Oppulence-Engineering/rowboat/commit/49a50279dac213a617a2e605b89067df024d409e))


### Documentation

* note srcdoc relative-asset limitation in html viewer ([89f56a8](https://github.com/Oppulence-Engineering/rowboat/commit/89f56a80598efa2ce4bc572bad6bcb4694bf0c8f))


### Refactors

* **App:** update sidebar toggle functionality and adjust button configurations ([1b81a42](https://github.com/Oppulence-Engineering/rowboat/commit/1b81a42ed31eac14a50646b14a60513614a3bc03))
* enhance delete run logic with locking mechanism and update sidebar button visibility ([6b0f31c](https://github.com/Oppulence-Engineering/rowboat/commit/6b0f31c369ec6f1fcb839cd4f5271ead188614c1))
* extract getViewerType helper to share extension list ([385ed33](https://github.com/Oppulence-Engineering/rowboat/commit/385ed3377ff6f415cc29a01fbc7b2e195c8a0a81))
* integrate context menu for delete action in sidebar tasks section ([c107d7c](https://github.com/Oppulence-Engineering/rowboat/commit/c107d7ca8403144cb1a7100465fbb092a49c4397))
* remove folder and file icons in knowledge ([c5c36ed](https://github.com/Oppulence-Engineering/rowboat/commit/c5c36ed0e4d2bb3d6e1e8f3def2c1c2cbee198af))
* remove New Chat button from sidebar content ([5f3b0a3](https://github.com/Oppulence-Engineering/rowboat/commit/5f3b0a317462636559f8415e9922963963a698db))
* remove unused button for new chat in the App component ([ce30c05](https://github.com/Oppulence-Engineering/rowboat/commit/ce30c056047fe7ef93100f18e9de72dde6f79cf8))
* remove unused MessageSquare icon from sidebar content ([23a1544](https://github.com/Oppulence-Engineering/rowboat/commit/23a1544a17e092e3b0991fd840c8d4fd6bb4798b))
* **sidebar:** simplify auto-collapse logic and improve sidebar toggle behavior ([1d29ca8](https://github.com/Oppulence-Engineering/rowboat/commit/1d29ca88864fc0526e50de3cddf3a31f4feb7bed))
* update input placeholder text from "Enter model ID" to "Enter model" in onboarding modal and settings dialog ([3ee1c2f](https://github.com/Oppulence-Engineering/rowboat/commit/3ee1c2f2abb9f1aa56bb34f9162492d314d16735))
* update titlebar styles and replace Separator with button for chat sidebar toggle ([14bcd5d](https://github.com/Oppulence-Engineering/rowboat/commit/14bcd5d8887d1a772930719b3c0d8e407379c0a1))
