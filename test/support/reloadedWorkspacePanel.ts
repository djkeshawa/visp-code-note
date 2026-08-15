/**
 * A panel coming back from a reload with two nested folders already open.
 *
 * That is the claim worth checking rather than assuming: expansion is remembered under
 * `folder:<path>` keys, which are only strings, so a nested path should need no new
 * persistence — but until now no nested path had ever been stored under one.
 */
import { installWorkspaceDom } from "./workspacePanelDom";

installWorkspaceDom(["folder:projects", "folder:projects/2026"]);
