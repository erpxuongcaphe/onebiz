import { createRoot } from "react-dom/client";
import OperationsWorkspace from "../../src/components/operations/workspace";
import { PageLeaveGuard } from "../../src/components/shared/page-leave-guard";
import "../../src/app/globals.css";
import "./harness.css";
createRoot(document.getElementById("root")!).render(<><PageLeaveGuard /><OperationsWorkspace /></>);
