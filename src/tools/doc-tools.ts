import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CONFIG } from "../shared/config";
import { generateDocumentUrl, getCurrentUser } from "../shared/utils";
import { applyEdits, compareLines, DocEdit, findRawHtml } from "../shared/doc-edits";

const PAGE_NOT_CHANGED = "The page was NOT changed.";
const MAX_SAMPLE_LINES = 5;

function pageApiUrl(doc_id: string, page_id: string): string {
  return `https://api.clickup.com/api/v3/workspaces/${CONFIG.teamId}/docs/${doc_id}/pages/${page_id}`;
}

/** Always a fresh read: editDocumentPage never works from a cached copy. */
async function fetchPage(doc_id: string, page_id: string): Promise<any> {
  const response = await fetch(pageApiUrl(doc_id, page_id), {
    headers: { Authorization: CONFIG.apiKey },
  });
  if (!response.ok) {
    throw new Error(`Error fetching page: ${response.status} ${response.statusText}. ${await response.text()}`);
  }
  return response.json();
}

// Parent types of docs and views (v2 view `parent.type`, v3 doc `parent.type`)
const PARENT_TYPES: Record<string, string> = { "4": "space", "5": "folder", "6": "list", "7": "everything", "12": "workspace" };

/** Page tree as indented "name (page_id: id)" lines, for echoing a deleted doc. */
function pageTreeLines(pageGroups: any[], depth: number = 0): string[] {
  return pageGroups.flatMap((page: any) => [
    `${'  '.repeat(depth)}- ${page.name} (page_id: ${page.id})`,
    ...pageTreeLines(page.pages || [], depth + 1),
  ]);
}

function sampleLines(lines: string[]): string {
  const shown = lines.slice(0, MAX_SAMPLE_LINES).map(line => `    ${JSON.stringify(line)}`);
  if (lines.length > MAX_SAMPLE_LINES) {
    shown.push(`    ... and ${lines.length - MAX_SAMPLE_LINES} more`);
  }
  return shown.join("\n");
}

/** Differences between what was written and what ClickUp stored, as warnings. */
function verificationWarnings(expected: string, actual: string, edits: DocEdit[]): string[] {
  const warnings: string[] = [];

  edits.forEach((edit, index) => {
    // A new_str rewritten by a later edit is absent from `expected` too: not ClickUp's doing
    if (edit.new_str && expected.includes(edit.new_str) && !actual.includes(edit.new_str)) {
      warnings.push(`edit ${index + 1}: new_str not found verbatim after the write - ClickUp's Markdown import rewrote it (e.g. *italic* is stored as _italic_). Check the page.`);
    }
  });

  const { missing, unexpected } = compareLines(expected, actual);
  if (missing.length > 0 || unexpected.length > 0) {
    const parts = [
      "ClickUp's Markdown import changed the page beyond the requested edits. This typically happens on the first API write of a page edited in the UI (layout normalised, blank lines dropped, indented blocks turned into list items); later edits of the same page are stable. Check the page.",
    ];
    if (missing.length > 0) {
      parts.push(`  ${missing.length} line(s) expected but missing:\n${sampleLines(missing)}`);
    }
    if (unexpected.length > 0) {
      parts.push(`  ${unexpected.length} line(s) not expected:\n${sampleLines(unexpected)}`);
    }
    warnings.push(parts.join("\n"));
  }

  return warnings;
}

/**
 * Helper function to recursively extract all pages from nested page structure
 */
function extractAllPages(pageGroup: any): any[] {
  const allPages = [];
  
  // Add the page itself
  allPages.push({
    id: pageGroup.id,
    name: pageGroup.name,
    doc_id: pageGroup.doc_id,
    parent_page_id: pageGroup.parent_page_id || null
  });
  
  // Recursively add nested pages
  if (pageGroup.pages && Array.isArray(pageGroup.pages)) {
    pageGroup.pages.forEach((nestedPage: any) => {
      allPages.push(...extractAllPages(nestedPage));
    });
  }
  
  return allPages;
}

/**
 * Helper function to display page hierarchy with proper indentation
 */
function displayPageHierarchy(pageGroup: any, currentPageId: string, depth: number = 0): string[] {
  const result = [];
  const indent = '  '.repeat(depth); // 2 spaces per level
  const isCurrentPage = pageGroup.id === currentPageId;
  const prefix = isCurrentPage ? '▶️ ' : '   ';
  const pageIndicator = isCurrentPage ? ' ← **Currently viewing**' : '';
  
  // Display this page
  result.push(`${indent}${prefix}${pageGroup.name} (${pageGroup.id})${pageIndicator}`);
  
  // Recursively display nested pages
  if (pageGroup.pages && Array.isArray(pageGroup.pages)) {
    pageGroup.pages.forEach((nestedPage: any) => {
      result.push(...displayPageHierarchy(nestedPage, currentPageId, depth + 1));
    });
  }
  
  return result;
}

export function registerDocumentToolsRead(server: McpServer) {
  // Workaround: SDK 1.27+ dual Zod v3/v4 type causes TS2589 on server.tool() generics
  const tool: (...args: any[]) => any = server.tool.bind(server);

  tool(
    "readDocument",
    [
      "Get a ClickUp document with page structure and content.",
      "Documents can be discovered via searchSpaces (which includes documents in space tree) or by direct URL from the user or within tasks.",
      "Always use the document URL when referencing documents in conversations or sharing with others.",
      "The response provides complete document metadata, page structure, and requested page content.",
      `Document URLs look like this: ${generateDocumentUrl('doc_id', 'page_id')}`,
    ].join("\n"),
    {
      doc_id: z
        .string()
        .min(1)
        .describe("The document ID to read"),
      page: z
        .string()
        .optional()
        .describe("Optional specific page ID or name to read (defaults to first page)")
    },
    {
      readOnlyHint: true
    },
    async ({ doc_id, page }: any) => {
      try {
        // First get the document details and page structure
        const [docResponse, pagesResponse] = await Promise.all([
          fetch(`https://api.clickup.com/api/v3/workspaces/${CONFIG.teamId}/docs/${doc_id}`, {
            headers: { Authorization: CONFIG.apiKey },
          }),
          fetch(`https://api.clickup.com/api/v3/workspaces/${CONFIG.teamId}/docs/${doc_id}/pageListing`, {
            headers: { Authorization: CONFIG.apiKey },
          })
        ]);

        if (!docResponse.ok) {
          throw new Error(`Error fetching document: ${docResponse.status} ${docResponse.statusText}`);
        }

        if (!pagesResponse.ok) {
          throw new Error(`Error fetching pages: ${pagesResponse.status} ${pagesResponse.statusText}`);
        }

        const docData = await docResponse.json();
        const pagesData = await pagesResponse.json();
        
        const doc = docData; // Document data is flat
        // Extract all pages while preserving hierarchy for display
        const pages: any[] = [];
        const hierarchicalPages = pagesData; // Keep original structure for hierarchy display
        
        // Extract flat list of pages for searching and navigation
        pagesData.forEach((pageGroup: any) => {
          pages.push(...extractAllPages(pageGroup));
        });

        if (pages.length === 0) {
          return {
            content: [{
              type: "text",
              text: `📄 **Document: ${doc.name}** (doc_id: ${doc_id})
📎 Document URL: ${generateDocumentUrl(doc_id)}

⚠️ This document exists but has no pages yet.

**Next steps:**
- Use \`createDocumentOrPage\` with doc_id="${doc_id}" to add the first page
- Example: createDocumentOrPage(doc_id="${doc_id}", name="Introduction", content="Your content here")`
            }],
          };
        }

        // Determine which page to read
        let targetPage = null;
        if (page) {
          // Look for page by ID first, then by name
          targetPage = pages.find((p: any) => p.id === page || p.name === page);
          if (!targetPage) {
            return {
              content: [{ 
                type: "text", 
                text: `Page "${page}" not found in document "${doc.name}". Available pages: ${pages.map((p: any) => `"${p.name}" (${p.id})`).join(', ')}`
              }],
            };
          }
        } else {
          // Default to first page
          targetPage = pages[0];
        }

        // Get the specific page content
        const pageResponse = await fetch(`https://api.clickup.com/api/v3/workspaces/${CONFIG.teamId}/docs/${doc_id}/pages/${targetPage.id}`, {
          headers: { Authorization: CONFIG.apiKey },
        });

        if (!pageResponse.ok) {
          throw new Error(`Error fetching page content: ${pageResponse.status} ${pageResponse.statusText}`);
        }

        const pageData = await pageResponse.json();
        const pageContent = pageData; // Page data is flat

        // Build the response
        const result = [];
        
        // Document header with metadata
        result.push(`doc_id: ${doc.id}`)
        result.push(`Document Title: ${doc.name}`);
        result.push(`Document URL: ${generateDocumentUrl(doc_id)}`);
        result.push(`Current page_id: ${targetPage.id}`);
        result.push(`Current Page Title: ${pageContent.name}`);
        result.push(`Current Page URL: ${generateDocumentUrl(doc_id, targetPage.id)}`);
        if (pageContent.date_updated) {
          result.push(`Current Page date_updated: ${pageContent.date_updated} (pass it as expected_date_updated to editDocumentPage)`);
        }

        // Page structure overview with hierarchy
        result.push('Page Structure:');
        hierarchicalPages.forEach((pageGroup: any) => {
          result.push(...displayPageHierarchy(pageGroup, targetPage.id));
        });

        // Current page content
        if (pageContent.content && pageContent.content.trim()) {
          result.push(`Page Content:`);
          return {
            content: [
              {type: "text", text: result.join('\n')},
              {type: "text", text: pageContent.content},
            ],
          };
        } else {
          result.push('*This page is empty.*');
          result.push('');
          result.push('**💡 To add content to this page:**');
          result.push(`Use \`updateDocumentPage\` with doc_id="${doc_id}", page_id="${targetPage.id}" and your content.`);
          result.push(`Example: updateDocumentPage(doc_id="${doc_id}", page_id="${targetPage.id}", content="Your content here")`);
          return {
            content: [
              {type: "text", text: result.join('\n')},
            ],
          };
        }

      } catch (error) {
        console.error('Error reading document:', error);
        return {
          content: [
            {
              type: "text",
              text: `Error reading document ${doc_id}: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );
}

export function registerDocumentToolsWrite(server: McpServer) {
  // Workaround: SDK 1.27+ dual Zod v3/v4 type causes TS2589 on server.tool() generics
  const tool: (...args: any[]) => any = server.tool.bind(server);

  tool(
    "updateDocumentPage",
    [
      "Updates an existing document page's content and/or name.",
      "Use this when you have both doc_id and page_id from readDocument.",
      "Content is in markdown format and can be replaced or appended.",
      "Always reference documents by their URLs when sharing with users."
    ].join("\n"),
    {
      doc_id: z
        .string()
        .min(1)
        .describe("The document ID containing the page (from readDocument)"),
      page_id: z
        .string()
        .min(1)
        .describe("The page ID to update (from readDocument)"),
      name: z
        .string()
        .optional()
        .describe("Optional: new name for the page"),
      content: z
        .string()
        .optional()
        .describe("Optional: page content in markdown format"),
      append: z
        .boolean()
        .optional()
        .describe("Whether to append content to existing page content (default: false - replaces content)")
    },
    {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
    async ({ doc_id, page_id, name, content, append = false }: any) => {
      try {
        const requestBody: any = {};

        if (name) {
          requestBody.name = name;
        }

        if (content !== undefined) {
          requestBody.content = content;
          requestBody.content_edit_mode = append ? 'append' : 'replace';
        }

        if (Object.keys(requestBody).length === 0) {
          return {
            content: [{
              type: "text",
              text: "Error: At least one of 'name' or 'content' must be provided for update."
            }],
          };
        }

        const response = await fetch(`https://api.clickup.com/api/v3/workspaces/${CONFIG.teamId}/docs/${doc_id}/pages/${page_id}`, {
          method: 'PUT',
          headers: {
            Authorization: CONFIG.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Error updating page: ${response.status} ${response.statusText}. ${errorText}`);
        }

        // Handle potentially empty response
        const responseText = await response.text();
        let updatedPage: any = {};

        if (responseText && responseText.trim()) {
          try {
            const data = JSON.parse(responseText);
            updatedPage = data.page || data;
          } catch (e) {
            // If JSON parsing fails, continue with empty updatedPage object
            console.error('Warning: Could not parse response JSON, but update was successful');
          }
        }

        const pageName = updatedPage.name || name || "page";

        return {
          content: [{
            type: "text",
            text: `✅ Successfully updated page "${pageName}" (page_id: ${page_id})\n\nPage URL: ${generateDocumentUrl(doc_id, page_id)}`
          }],
        };

      } catch (error) {
        console.error('Error updating document page:', error);
        return {
          content: [
            {
              type: "text",
              text: `Error updating page: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );

  tool(
    "editDocumentPage",
    [
      "Replaces portions of an existing document page instead of rewriting the whole page - use it to tick a checkbox, fix a line or add a note next to an item.",
      "Prefer it over updateDocumentPage for any change smaller than the page: the page is read right before the write, so changes made by others since your own read are kept, and you do not resend the full content.",
      "Each edit replaces `old_str` with `new_str`. Edits are applied in order, each on the result of the previous ones. Every `old_str` must occur exactly once in the page's current Markdown, otherwise NOTHING is written and the error names the failing edit (not found / found N times).",
      "Copy `old_str` from readDocument output: ClickUp exports its own Markdown flavour (`*   ` bullets, `_italic_`, `\\.` escapes in list items...), which may differ from what was originally written.",
      "Pages containing raw HTML are refused: ClickUp escapes it one level deeper at each write, so every rewrite would damage them.",
      "LIMITS: the ClickUp API has no partial or conditional write - the tool still rewrites the whole page from its fresh read, so a change made by someone else in the few hundred milliseconds between that read and the write is lost. Pass `expected_date_updated` to refuse the edit if the page changed since your own read.",
      "After writing, the page is read back and any line ClickUp's Markdown import changed outside the requested edits is reported as a warning. The response is a short summary, not the page.",
      "Always reference documents by their URLs when sharing with users.",
    ].join("\n"),
    {
      doc_id: z
        .string()
        .min(1)
        .describe("The document ID containing the page (from readDocument)"),
      page_id: z
        .string()
        .min(1)
        .describe("The page ID to edit (from readDocument)"),
      edits: z
        .array(z.object({
          old_str: z.string().min(1).describe("Exact text to replace, copied from the page's current Markdown; must occur exactly once"),
          new_str: z.string().describe("Replacement text in Markdown (empty string deletes old_str)"),
        }))
        .min(1)
        .describe("Replacements applied in order, all or nothing"),
      expected_date_updated: z
        .union([z.number(), z.string().regex(/^\d+$/)])
        .optional()
        .describe("Optional: the page's date_updated (ms timestamp shown by readDocument) your edits are based on. If the page changed since, nothing is written."),
      dry_run: z
        .boolean()
        .optional()
        .describe("Optional: only check that every old_str matches exactly once, without writing (default: false)"),
    },
    {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
    },
    async ({ doc_id, page_id, edits, expected_date_updated, dry_run = false }: any) => {
      try {
        const page = await fetchPage(doc_id, page_id);
        const content: string = page.content || "";
        const pageLabel = `page "${page.name}" (page_id: ${page_id})`;
        const pageUrl = generateDocumentUrl(doc_id, page_id);

        if (expected_date_updated !== undefined && String(page.date_updated) !== String(expected_date_updated)) {
          throw new Error(`${pageLabel} changed since ${expected_date_updated} (date_updated is now ${page.date_updated}). Read it again with readDocument and redo the edits. ${PAGE_NOT_CHANGED}`);
        }

        const html = findRawHtml(content);
        if (html) {
          const sample = html.length > 80 ? `${html.slice(0, 80)}...` : html;
          throw new Error(`${pageLabel} contains raw HTML (${sample}), which ClickUp escapes one level deeper at each write - editing it through the API would damage it. Remove the HTML in the ClickUp UI or edit the page there. ${PAGE_NOT_CHANGED}`);
        }

        let edited: string;
        try {
          edited = applyEdits(content, edits);
        } catch (error) {
          throw new Error(`${error instanceof Error ? error.message : String(error)}. ${PAGE_NOT_CHANGED}`);
        }

        const count = `${edits.length} edit${edits.length > 1 ? "s" : ""}`;

        if (dry_run) {
          return {
            content: [{
              type: "text",
              text: `Dry run: ${count} would be applied to ${pageLabel}, every old_str matches exactly once. Nothing was written.\n\nPage URL: ${pageUrl}`,
            }],
          };
        }

        const response = await fetch(pageApiUrl(doc_id, page_id), {
          method: 'PUT',
          headers: {
            Authorization: CONFIG.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: edited, content_edit_mode: 'replace', content_format: 'text/md' }),
        });

        if (!response.ok) {
          throw new Error(`Error updating page: ${response.status} ${response.statusText}. ${await response.text()}`);
        }

        // The write succeeded: a failing verification read must not be reported as a
        // failed edit, or the caller would retry edits that are already applied.
        let written: any;
        try {
          written = await fetchPage(doc_id, page_id);
        } catch (error) {
          return {
            content: [{
              type: "text",
              text: [
                `✅ ${count} applied to ${pageLabel}`,
                `Page URL: ${pageUrl}`,
                "",
                `⚠️ Warning: the write succeeded but could not be verified (${error instanceof Error ? error.message : String(error)}) - do NOT repeat the edits. Check the page with readDocument later.`,
              ].join("\n"),
            }],
          };
        }
        const warnings = verificationWarnings(edited, written.content || "", edits);

        const lines = [
          `✅ ${count} applied to ${pageLabel}`,
          `date_updated: ${written.date_updated}`,
          `Page URL: ${pageUrl}`,
        ];
        if (warnings.length > 0) {
          lines.push("", ...warnings.map(warning => `⚠️ Warning: ${warning}`));
        }

        return {
          content: [{ type: "text", text: lines.join("\n") }],
        };

      } catch (error) {
        console.error('Error editing document page:', error);
        return {
          content: [
            {
              type: "text",
              text: `Error editing page: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );

  tool(
    "deleteDocument",
    [
      "Deletes a whole ClickUp document with all its pages. Check it with readDocument first.",
      "GUARDRAILS: only documents created by the API token's own user can be deleted. Other people's documents must be deleted in the ClickUp UI.",
      "ClickUp only flags the document as deleted (it should be restorable from the Trash in the UI). The response echoes its name, location and page tree.",
      "There is no way to delete a single page through the API.",
    ].join("\n"),
    {
      doc_id: z
        .string()
        .min(1)
        .describe("The document ID to delete (from readDocument or the document URL)"),
    },
    {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
    async ({ doc_id }: any) => {
      try {
        // The v3 API has no doc deletion, but a doc is also a view of type "doc"
        // with the same id, and deleting that view deletes the doc. Checking the
        // type first prevents deleting a list/board view given by mistake.
        const viewResponse = await fetch(`https://api.clickup.com/api/v2/view/${doc_id}`, {
          headers: { Authorization: CONFIG.apiKey },
        });
        if (!viewResponse.ok) {
          // Verified live: an unknown or deleted doc answers 404 "View not found" (OAUTH_058)
          const reason = viewResponse.status === 404 ? `document ${doc_id} not found` : `could not read document ${doc_id}`;
          throw new Error(`${reason} (${viewResponse.status} ${viewResponse.statusText}). ${await viewResponse.text()} Nothing was deleted.`);
        }
        const { view } = await viewResponse.json();

        if (!view || view.type !== "doc") {
          throw new Error(`${doc_id} is not a document but a view of type "${view?.type}" ("${view?.name}"). Nothing was deleted.`);
        }

        const userData = await getCurrentUser();
        if (String(view.creator) !== String(userData.user.id)) {
          throw new Error(`"${view.name}" (doc_id: ${doc_id}) was created by user ${view.creator}: only documents you created can be deleted. Nothing was deleted.`);
        }

        const pagesResponse = await fetch(`https://api.clickup.com/api/v3/workspaces/${CONFIG.teamId}/docs/${doc_id}/pageListing`, {
          headers: { Authorization: CONFIG.apiKey },
        });
        if (!pagesResponse.ok) {
          throw new Error(`Error fetching pages: ${pagesResponse.status} ${pagesResponse.statusText}. Nothing was deleted.`);
        }
        const pageGroups = await pagesResponse.json();
        // The page tree is the only record of what gets deleted: never echo a wrong one
        if (!Array.isArray(pageGroups)) {
          throw new Error(`unexpected page listing format (${JSON.stringify(pageGroups).slice(0, 200)}). Nothing was deleted.`);
        }

        const response = await fetch(`https://api.clickup.com/api/v2/view/${doc_id}`, {
          method: 'DELETE',
          headers: { Authorization: CONFIG.apiKey },
        });
        if (!response.ok) {
          throw new Error(`${response.status} ${response.statusText}. ${await response.text()}`);
        }

        const pageLines = pageTreeLines(pageGroups);
        return {
          content: [{
            type: "text",
            text: [
              `🗑️ Deleted document "${view.name}" (doc_id: ${doc_id}) - ClickUp only flags it as deleted, it should be restorable from the Trash in the UI.`,
              `Location: ${view.parent ? `${PARENT_TYPES[String(view.parent.type)] || `type ${view.parent.type}`} ${view.parent.id}` : 'unknown'}`,
              `Pages (${pageLines.length}):`,
              ...(pageLines.length > 0 ? pageLines : ['  (none)']),
            ].join('\n'),
          }],
        };

      } catch (error) {
        console.error('Error deleting document:', error);
        return {
          content: [
            {
              type: "text",
              text: `Error deleting document: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );

  tool(
    "createDocumentOrPage",
    [
      "Creates a new document with its first page, OR adds a page to an existing document.",
      "To create a NEW document: provide space_id OR list_id + name + content",
      "To add a page to EXISTING document: provide doc_id + name + content",
      "To create a sub-page: provide doc_id + parent_page_id + name + content",
      "Content is in markdown format and supports ClickUp's markdown features.",
      "Always reference documents by their URLs when sharing with users."
    ].join("\n"),
    {
      space_id: z
        .string()
        .optional()
        .describe("Create NEW document in this space (mutually exclusive with list_id and doc_id)"),
      list_id: z
        .string()
        .optional()
        .describe("Create NEW document in this list (mutually exclusive with space_id and doc_id)"),
      doc_id: z
        .string()
        .optional()
        .describe("Add page to EXISTING document with this ID (mutually exclusive with space_id and list_id)"),
      parent_page_id: z
        .string()
        .optional()
        .describe("Optional: when provided with doc_id, creates a sub-page under this parent page"),
      name: z
        .string()
        .min(1)
        .describe("Name for the document/page being created"),
      content: z
        .string()
        .optional()
        .describe("Optional: page content in markdown format")
    },
    {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    },
    async ({ space_id, list_id, doc_id, parent_page_id, name, content }: any) => {
      try {
        // Validate mutually exclusive parameters
        const locationParams = [space_id, list_id, doc_id].filter(Boolean).length;
        if (locationParams !== 1) {
          return {
            content: [{
              type: "text",
              text: "Error: Provide exactly ONE of: space_id (new doc in space), list_id (new doc in list), or doc_id (page in existing doc)."
            }],
          };
        }

        if (parent_page_id && !doc_id) {
          return {
            content: [{
              type: "text",
              text: "Error: parent_page_id requires doc_id to be provided."
            }],
          };
        }

        // Case 1: Create new document in space or list
        if (space_id || list_id) {
          const parentId = space_id || list_id;
          const parentType = space_id ? 4 : 6; // 4=Space, 6=List

          // Create new document
          const docRequestBody = {
            name: name,
            create_page: false,
            parent: {
              id: parentId,
              type: parentType
            }
          };

          const docResponse = await fetch(`https://api.clickup.com/api/v3/workspaces/${CONFIG.teamId}/docs`, {
            method: 'POST',
            headers: {
              Authorization: CONFIG.apiKey,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(docRequestBody),
          });

          if (!docResponse.ok) {
            const errorText = await docResponse.text();
            throw new Error(`Error creating document: ${docResponse.status} ${docResponse.statusText}. ${errorText}`);
          }

          const docData = await docResponse.json();
          const newDocId = docData.id;

          // Create the first page
          const pageRequestBody = {
            name: name,
            content: content || '',
          };

          const pageResponse = await fetch(`https://api.clickup.com/api/v3/workspaces/${CONFIG.teamId}/docs/${newDocId}/pages`, {
            method: 'POST',
            headers: {
              Authorization: CONFIG.apiKey,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(pageRequestBody),
          });

          if (!pageResponse.ok) {
            const errorText = await pageResponse.text();
            throw new Error(`Error creating first page: ${pageResponse.status} ${pageResponse.statusText}. ${errorText}`);
          }

          const pageData = await pageResponse.json();
          const firstPage = pageData.page || pageData;

          return {
            content: [{
              type: "text",
              text: `✅ Successfully created new document "${name}" (doc_id: ${newDocId})\n\nDocument URL: ${generateDocumentUrl(newDocId)}\nFirst Page URL: ${generateDocumentUrl(newDocId, firstPage.id)}`
            }],
          };
        }

        // Case 2: Add page to existing document or create sub-page
        if (doc_id) {
          const pageRequestBody: any = {
            name: name,
            content: content || '',
          };

          if (parent_page_id) {
            pageRequestBody.parent_page_id = parent_page_id;
          }

          const response = await fetch(`https://api.clickup.com/api/v3/workspaces/${CONFIG.teamId}/docs/${doc_id}/pages`, {
            method: 'POST',
            headers: {
              Authorization: CONFIG.apiKey,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(pageRequestBody),
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Error creating page: ${response.status} ${response.statusText}. ${errorText}`);
          }

          const data = await response.json();
          const newPage = data.page || data;

          const pageType = parent_page_id ? "sub-page" : "page";
          const parentInfo = parent_page_id ? ` under parent page ${parent_page_id}` : "";

          return {
            content: [{
              type: "text",
              text: `✅ Successfully created ${pageType} "${newPage.name}" (page_id: ${newPage.id})${parentInfo}\n\nPage URL: ${generateDocumentUrl(doc_id, newPage.id)}`
            }],
          };
        }

        return {
          content: [{ type: "text", text: "Error: Unexpected state in document/page creation." }],
        };

      } catch (error) {
        console.error('Error creating document or page:', error);
        return {
          content: [
            {
              type: "text",
              text: `Error creating document or page: ${error instanceof Error ? error.message : 'Unknown error'}`,
            },
          ],
        };
      }
    }
  );
}