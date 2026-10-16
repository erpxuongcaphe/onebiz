const fs=require('node:fs');const path=require('node:path');const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'../..');const target=path.resolve(process.argv[2]||'');
const allowed='C:\\Users\\ADMIN\\Documents\\Codex\\';
if((!target.startsWith(allowed)&&!target.startsWith(root+path.sep+'.tmp'+path.sep))||target===root)throw Error('Use the dedicated isolated build output directory');
const files=execFileSync('git',[`--work-tree=${root}`,'ls-files','-z','--cached','--others','--exclude-standard'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
for(const file of files){if(file.startsWith('.tmp/')||file.startsWith('.env')||file.startsWith('backups/')||file.startsWith('node_modules/')||file.endsWith('pnpm-lock.yaml'))continue;const source=path.join(root,file);if(!fs.existsSync(source)||!fs.statSync(source).isFile())continue;const dest=path.resolve(target,file);if(!dest.startsWith(target+path.sep))throw Error('Invalid path');fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(source,dest);}
if(!fs.existsSync(path.join(target,'node_modules')))fs.symlinkSync(path.join(root,'node_modules'),path.join(target,'node_modules'),'junction');
console.log(`Copied ${files.length} source paths; excluded .env and backups. Build root: ${target}`);
