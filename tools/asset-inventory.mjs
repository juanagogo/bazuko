import {readdir,stat,readFile} from 'node:fs/promises';
import {join,extname,relative,dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const root=join(import.meta.dirname,'../public');
async function walk(dir){const files=[];for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())files.push(...await walk(path));else files.push(path);}return files;}
const extensions={},hashes=new Map(),largest=[];
for(const path of await walk(root)){const bytes=(await stat(path)).size,ext=extname(path);extensions[ext]??={files:0,bytes:0};extensions[ext].files++;extensions[ext].bytes+=bytes;largest.push({path:relative(root,path).replaceAll('\\','/'),bytes});const hash=createHash('sha256').update(await readFile(path)).digest('hex');if(!hashes.has(hash))hashes.set(hash,[]);hashes.get(hash).push(relative(root,path));}
const missing=[];let references=0;
for(const path of await walk(root))if(extname(path)==='.gltf'){
 const gltf=JSON.parse(await readFile(path,'utf8'));
 for(const resource of [...(gltf.buffers??[]),...(gltf.images??[])]){
  if(!resource.uri||/^(data:|https?:)/.test(resource.uri))continue;
  references++;try{await stat(resolve(dirname(path),decodeURIComponent(resource.uri)));}catch{missing.push({file:relative(root,path),uri:resource.uri});}
 }
}
console.log(JSON.stringify({extensions,largest:largest.sort((a,b)=>b.bytes-a.bytes).slice(0,20),identicalFiles:[...hashes.values()].filter(paths=>paths.length>1),references,missing,note:'Disk sizes are not decoded texture/GPU memory; duplicate bytes are not proof that either path is unused.'},null,2));
if(missing.length)process.exitCode=1;
