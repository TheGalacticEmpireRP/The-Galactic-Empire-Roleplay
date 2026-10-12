import {createRoot} from "react-dom/client";
import SupportCenter from "./support-center";
import "./styles.css";
const mode=location.pathname.replace(/\/$/,"")==="/staff"?"staff":"overview";
createRoot(document.getElementById("root")!).render(<SupportCenter initialMode={mode}/>);
