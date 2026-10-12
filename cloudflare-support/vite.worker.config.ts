import {defineConfig} from "vite";
export default defineConfig({
  publicDir:false,
  build:{outDir:"dist",emptyOutDir:false,minify:true,target:"es2022",
    lib:{entry:"worker/index.ts",formats:["es"],fileName:()=>"_worker.js"}}
});
