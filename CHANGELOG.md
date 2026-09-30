# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **Merged upstream [hauptsacheNet/clickup-mcp](https://github.com/hauptsacheNet/clickup-mcp) 1.9.0.** The fork now carries the upstream history, so future upstream releases merge incrementally instead of being copied commit by commit.
- **`replace_description` is renamed `description`** on `updateTask` and `updateListInfo`, matching the upstream parameter name. Behaviour is unchanged: mutually exclusive with `append_description`, the previous description is echoed back, an empty string clears the description.
- Task IDs are bounded to 6-16 characters again (upstream 1.7.3): ClickUp lengthened generated IDs in August 2026, and the bound is what rejects task URLs before they cost an API call.

### Added (from upstream)
- `getTaskById` renders threaded comment replies under their parent, shows each top-level `comment_id`, lists `waiting_on` / `blocking` / `linked_tasks`, and pages comment history beyond the 25 newest.
- `addComment` accepts `parent_comment_id` to reply inside a thread.
- Comments support markdown tables (rendered as aligned pipe tables in a code block, since ClickUp cannot render tables), `~~strikethrough~~` and multi-line code blocks, in both directions.
- `updateTask` can actually remove task links via `linked_tasks` (link records are identified by their far end).
- `CLICKUP_COMMENT_EDIT_WINDOW_HOURS` and `MAX_UPLOAD_SIZE_MB` are exposed as MCPB installer fields; blank or unsubstituted values fall back to the defaults, invalid numbers fail at startup.

## [1.9.0] - 2026-09-30

### Added
- **Sprint points** - `createTask` and `updateTask` accept an optional `points` parameter (non-negative number) mapped to ClickUp's `points` task field. `getTaskById` now shows the task's sprint points when set. Requires the Sprint Points ClickApp to be enabled on the space. Valid values depend on the points scale each workspace configures, so they are not validated locally - ClickUp rejects anything off the scale with `not a valid points selection`.
- **Unassigning users** - `updateTask` accepts `remove_assignees` (user IDs), sent as the `rem` side of ClickUp's `assignees` object. Combined with `assignees`, one person can be swapped for another in a single call. Previously assignees could only be added.
- **`updateTimeEntry` and `deleteTimeEntry` tools** - adjust or remove a time entry instead of living with a wrong booking. `updateTimeEntry` changes the duration (decimal hours), start time, description or task; `deleteTimeEntry` is irreversible, so its response echoes the deleted values for a `createTimeEntry` redo. Both read the entry first and refuse entries belonging to other users (`getTimeEntries` can list them with `include_all_users`) as well as running timers. Start, end and duration are always sent together: ClickUp leaves `end` untouched when only `start` is sent, which would make the entry inconsistent.
- `getTimeEntries` now shows the `entry_id` of every entry, which the two tools above need.
- **Replacing descriptions** - `updateTask` and `updateListInfo` accept `replace_description` next to `append_description`. Until now the tools only appended a dated block, and the "append-only" wording in their descriptions made the LLM tell users that descriptions could not be edited. Replace rewrites the whole description (images go through the same upload pipeline); the two parameters are mutually exclusive, and the previous description is echoed back so a wrong replacement can be undone with another call.
- **`deleteComment` tool** - removes an own task comment, with the same guardrails as `editComment` (own comments only, within `CLICKUP_COMMENT_EDIT_WINDOW_HOURS` of creation). The deleted text is echoed back for a re-post via `addComment`.
- **Clearing values** - `updateTask` accepts `null` for `due_date`, `start_date`, `time_estimate` and `points` to remove the current value. `null` is sent as is: converting it like a real date would have set it to 1970-01-01. The time estimate is the exception - ClickUp accepts `null` but silently keeps the estimate, so it is cleared by sending `0` (verified against the live API).

## [1.8.1] - 2026-09-30

### Fixed
- **Blank lines between paragraphs are kept in comments.** remark drops the blank line separating two markdown blocks, and the converter only emitted a single line break after each paragraph (none after a list), so `addComment` and `editComment` glued paragraphs and lists into one dense block. An empty line fragment is now emitted wherever the source has a blank line between two blocks; several blank lines collapse into one, and a list written directly under its intro line stays attached to it.

## [1.8.0] - 2026-08-17

### Added
- **`editComment` tool** - replaces the text of an existing task comment instead of forcing a follow-up comment when something in a just-posted comment turns out to be wrong. Formatting and images survive the edit, because ClickUp's `PUT /comment/{id}` accepts the same rich fragment array as comment creation (undocumented - the API reference only lists `comment_text`, which would flatten the comment to plain text). Images are resolved and uploaded before the edit, so a broken image reference leaves the existing comment untouched.
- Two guardrails, since ClickUp cannot distinguish a comment written through this MCP from one written by the same user in the web UI:
  - only comments belonging to the API token's own user can be edited, so other people's comments are safe
  - only comments created within `CLICKUP_COMMENT_EDIT_WINDOW_HOURS` (default 24) can be edited. Editing does not change the creation date, so the window cannot be extended by repeated edits.
- New `CLICKUP_COMMENT_EDIT_WINDOW_HOURS` environment variable (default 24, `0` disables `editComment`). An unparsable value fails at startup instead of silently widening or disabling the window.
- **Inline image upload** - `![caption](path)` in `addComment`, `createTask` and `updateTask` now uploads the image and embeds it in the ticket.
  Accepted sources: local file paths, `data:` URIs, http(s) URLs, and existing ClickUp attachment URLs (reused without re-uploading).
  Because the server runs locally, a screenshot can be referenced by path instead of being inlined as base64, which costs orders of magnitude fewer tokens.
  The caption becomes the attachment filename, which is what ClickUp displays beneath the image.
  Only real PNG/JPEG/GIF/WebP files are uploaded (verified via magic bytes).
- New `MAX_UPLOAD_SIZE_MB` environment variable (default 10) to cap the size of a single uploaded image
- New `npm run smoke` protocol smoke test that drives the built server over real MCP stdio (initialize, tools/list, tool schemas) and optionally posts a comment with an image. `npm run cli` calls tool callbacks directly and never covered this layer.
- Tests for the image failure paths: missing local file, non-image file, unreachable http(s) URL, upload API error with partial success, and abort behaviour of all three write tools.
- **Task URLs in comments become live task references.** A ClickUp task URL in `addComment`/`editComment` markdown (bare or as a link) is converted to a real `task_mention` fragment, rendering as the same chip with live task name, status and assignee that the ClickUp UI creates - instead of a plain blue link. Custom link text on a task URL is replaced by the live task name; URLs with a query or fragment (e.g. `?comment=` deep links) and custom task IDs stay ordinary links. Reading a comment returns mentions as task URLs, so the `editComment` round trip preserves them. Task *descriptions* keep rendering task URLs as plain links - the public API's `markdown_description` cannot express mention chips (verified empirically: ClickUp neither converts URLs server-side nor re-hydrates its own flattened mention export).

### Changed
- **Images are now read back as markdown.** `getTaskById` used to render an image inside a comment or description as `Image: name - url`, which is not something the write tools understand. It is now `![name](url)`, the same syntax `addComment`/`editComment`/`createTask`/`updateTask` accept. This closes the read-edit round trip: a comment read from a task can be handed back to `editComment` unchanged and keeps its images, because an existing ClickUp attachment URL is re-embedded instead of re-uploaded.
- **Image failures abort the write instead of degrading it.** A broken image reference (missing file, dead URL, file that is not a real image, oversized upload) makes `addComment`, `createTask` and `updateTask` fail with a per-image error report *before* anything is written - no comment is posted, no task is created or modified. The caller can fix the markdown and retry without creating duplicates.
- `createTask` resolves and validates all description images before creating the task. Only an upload API failure after creation is reported as a WARNING, since the task already exists at that point.
- When an upload fails halfway through a batch, the error lists the images that were already uploaded with their CDN URLs, so a retry can reference those URLs directly instead of uploading them again.

### Notes
- ClickUp shows no "edited" marker on a changed comment and exposes none via the API, so readers who already saw the original will not notice the change. The tool description tells the model to prefer a follow-up comment once a discussion has started.
- Replies inside a comment thread live behind a different endpoint and cannot be edited; `editComment` reports this instead of failing silently.
- `GET /task/{id}/comment` returns only the 25 newest comments per page (`start_date` is not a real parameter and is ignored). `editComment` pages back with `start`/`start_id` and stops as soon as a page ends outside the edit window, so a busy ticket still costs a single request in the normal case.

## [1.7.4] - 2026-06-22

### Fixed
- Restore the executable bit on `dist/index.js` during `prepublishOnly`, so the published npm tarball ships the `bin` entry as executable (it was lost as of 1.7.3, published with mode `0644`)

## [1.7.3] - 2026-06-22

### Fixed
- Removed the brittle 6-9 character cap on `isTaskId`, so internal task IDs of 10+ characters (e.g. `wdrv93ebwx`) are now accepted
- `getTimeEntries` and `createTimeEntry` now accept custom task IDs (e.g. `SOI-4422`) and resolve them to internal IDs, like the other task tools

## [1.7.2] - 2026-03-23

### Added
- Added `include_closed` and `archived` parameters to `searchTasks` to optionally include closed or archived tasks (both default to false)

## [1.7.1] - 2026-03-19

### Fixed
- Fix tags not being added when creating a task (tags were ignored in the request body and not handled post-creation)

## [1.7.0] - 2026-03-19

### Changed
- Mise à jour de `@modelcontextprotocol/sdk` de 1.15.1 vers 1.27.1
- Renommage de `_registeredTools[].callback` en `.handler` (breaking change SDK)
- Ajout de wrappers `tool()` pour contourner le TS2589 causé par le double support Zod v3/v4 du SDK

### Added
- **Custom Task ID support** - All tools accepting a `task_id` (`getTaskById`, `addComment`, `updateTask`, `searchTasks`) now accept custom task IDs (e.g. `SOI-4422`) in addition to internal IDs. Custom IDs are automatically resolved to internal IDs via the ClickUp API.
- Added comparison table in README showing differences between this MCP and the official ClickUp MCP
- Extended `searchSpaces` with `folder_id` parameter to resolve a ClickUp folder by ID, returning its lists, statuses, and parent space

### Fixed
- `getFolderDetails()` now fetches lists via dedicated `/folder/{id}/list` endpoint instead of relying on the folder payload embedding them
- Fixed image MIME type detection by inspecting binary magic bytes instead of trusting HTTP headers or fallback values
- Images in comments are no longer silently dropped - `![](...)` previously vanished without a warning because mdast image nodes were not handled
- Fixed the CLI discarding any multi-line parameter value (the `key=value` pattern did not match across newlines), which made markdown impossible to test via `npm run cli`
- Fixed the test suite never reaching its mocks: `undici`'s `MockAgent` cannot intercept Node's built-in global `fetch`, so every test made real network calls and failed on DNS. 17 of 31 tests were failing before this fix

## [1.6.0] - 2025-11-25

### Added
- **Full markdown support for comments** - `addComment` now converts markdown to ClickUp's rich text format
- Comments now preserve formatting when reading back from ClickUp, including nested formatting

## [1.5.1] - 2025-10-02

### Changed
- The space resource now has a `ClickUp Space` suffix in the title.
- Add additional hints to all tools to potentially improve client handling.

### Added
- Added Icon to the manifest.json file.

## [1.5.0] - 2025-10-01

### Breaking Changes
- Replaced `writeDocument` tool with two focused tools for better clarity:
  - `updateDocumentPage`: Updates existing pages (requires doc_id and page_id)
  - `createDocumentOrPage`: Creates new documents or pages (uses space_id/list_id/doc_id)
- This change makes parameter requirements clearer and eliminates the confusion between creating and updating operations

### Fixed
- Fixed "my-todos" prompt failing with "Failed to get prompt" error in Claude Desktop by adding `prompts_generated: true` to manifest.json to declare runtime-generated prompts
- Fixed critical bug in document page updates: now uses correct ClickUp API v3 endpoint (`/workspaces/{teamId}/docs/{docId}/pages/{pageId}`) instead of incorrect endpoint that was causing 404 errors
- Fixed empty response handling in `updateDocumentPage` - now gracefully handles ClickUp API responses that don't return JSON body

### Removed
- Removed `searchDocuments` tool as it only searched document names/spaces, not content, which confused LLMs that are trained on fulltext searches. Documents can still be discovered via `searchSpaces` (which includes documents in space tree) or by direct URL.

### Changed
- Removed time entries from `searchTasks` results to improve reliability and prevent rate limit issues. Time entries are still available via `getTaskById` for individual tasks.
- Updated `readDocument` to reference new tool names (`updateDocumentPage` and `createDocumentOrPage`) in its suggestions

## [1.4.3] - 2025-09-26

### Fixed
- Add required `title` field to MCP space resources to comply with newer MCP specification

## [1.4.2] - 2025-09-23

### Added
- Task dependency and relationship management in `updateTask` tool (thanks @itinance)

### Fixed
- Strip inline base64 data URIs from `getTaskById` responses and surface them as proper image blocks instead of embedding them in text content

## [1.4.1] - 2025-08-31

### Fixed
- Fixed tag management in `updateTask` - tags are now properly added/removed using dedicated API endpoints (thanks @itinance)
- Fixed Claude Desktop dxt support. It had the word `cli` in the argument list which triggered the cli debug mode of this library.

## [1.4.0] - 2025-08-18

### Added
- MCP Resources support for dynamic ClickUp space discovery
  - Spaces now appear in Claude Desktop's resource dropdown for easy selection
  - Dynamic resource templates provide real-time space listing without server restart
  - Complete space tree structure with lists, folders, documents, and metadata
  - Resource URIs using `clickup://space/{spaceId}` format for consistent identification

## [1.3.2] - 2025-08-05

### Fixed
- Fix `writeDocument` API response parsing when creating pages in existing documents
- Add fallback handling for both nested (`data.page`) and flat response formats

## [1.3.1] - 2025-07-22

### Added
- Add `readOnlyHint` annotations to all MCP tools to improve user experience
- Add a prompt for "my-todos" in English and German, as a shortcut.

## [1.3.0] - 2025-07-11

### Added
- Document management tools for ClickUp Docs
  - `readDocument` - Read documents with page structure and content
  - `searchDocuments` - Search documents by name and space with fuzzy matching
  - `writeDocument` - Create and update documents and pages with smart parent detection
- Added Server instructions with all ClickUp Spaces to help the LLM make better decisions.

### Fixed
- Null attachment handling in task metadata
- URL generation for lists and spaces

### Improved
- Enhanced search relevance weighting for multi-term queries
- Optimized search scoring with multiple term matches

## [1.2.0] - 2025-07-02

### Added
- Claude DXT manifest.json file for enhanced integration
- Intelligent image handling for ClickUp tasks
- Parent task ID support in task creation and update operations
- Space tags fetching and display in list tools
- Status filtering enhancements in search tools
- Space search functionality replacing generic listing tools

### Changed
- Task description and status update guidelines clarified
- Server version now loaded dynamically from package.json
- Improved caching for promises and enhanced time entries handling
- Split task tools write functionality into separate module for better modularity
- Simplified task-tools descriptions for assignees and update tracking

### Fixed
- Enhanced promise caching to prevent race conditions

## [1.1.1] - 2025-06-17

### Added
- ClickUp URL generation and markdown link formatting utilities
- Enhanced time tools with team-wide filtering and hierarchical output
- New formatting utilities for better data presentation

### Changed
- Simplified private field handling and removed redundant URL guidance
- Improved tool integration for enhanced navigation

## [1.1.0] - 2025-06-16

### Added
- Safe append-only updates for task and list descriptions with markdown support
- MCP mode support and tool segmentation for configurable functionality
- Enhanced time and list tools with getListInfo functionality
- Assignee-based filtering and updates across task tools
- Task comments and status updates support
- Extended valid task ID length to 6-9 characters

### Changed
- Updated README with experimental notice and enhanced feature details
- Enhanced tool descriptions with best practices and important usage notes
- Enriched README with expanded usage examples and optimized AI workflows
- Consolidated task creation/update logic, removed create-tools
- Modularized task search with filters, caching, and fuzzy matching
- Simplified server setup and improved code modularity

### Fixed
- Improved task creation and update functionalities for assignees

## [1.0.5] - 2025-06-03

### Added
- Enhanced task metadata with priority, dates, time estimates, tags, watchers, URL, archived status, and custom fields

## [1.0.4] - 2025-05-26

### Added
- Chronological status history and comment events to task content

### Fixed
- Handle non-string text items in ClickUp text parser by stringifying unknown types

## [1.0.3] - 2025-05-22

### Added
- Fuzzy search with Fuse.js and language-aware search guidance
- Space details to task metadata and .env configuration support
- Enhanced task search to support direct task ID lookups alongside text search

## [1.0.2] - 2025-05-09

### Added
- Image limit functionality with MAX_IMAGES env var and newest-first sorting
- Parent/child task metadata and improved documentation

## [1.0.1] - 2025-05-08

### Fixed
- Executable configuration for npx usage

## [1.0.0] - 2025-05-08

### Added
- Initial release of ClickUp MCP server
- Task search and retrieval functionality
- Markdown and text processing capabilities
- Image processing with attachment support
- MCP server setup and configuration
- Basic README with setup instructions

### Changed
- Consolidated markdown and text processing into unified clickup-text module
- Improved markdown image processing with dedicated loader function

### Fixed
- Initial setup and configuration for npm publishing
