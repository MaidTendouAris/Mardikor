import math from "@vscode/markdown-it-katex";
import { enablePreviewMath } from "./preview";
import "./markdown.worker";

enablePreviewMath(math);
