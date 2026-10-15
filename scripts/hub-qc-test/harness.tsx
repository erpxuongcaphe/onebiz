import { createRoot } from "react-dom/client";
import OperationsWorkspace from "../../src/components/operations/workspace";
import "../../src/app/globals.css";
import "./harness.css";
createRoot(document.getElementById("root")!).render(<OperationsWorkspace />);
