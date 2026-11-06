'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
async function parseDocument(filename){
  const stat=await fs.stat(filename);if(stat.size>50*1024*1024)throw new Error('请使用 50 MB 以内的文件');
  const ext=path.extname(filename).toLowerCase(),buffer=await fs.readFile(filename);let pages=[];
  if(['.txt','.md'].includes(ext)){const body=buffer.toString('utf8');pages=body.split(/\n\s*\n/).map((text,i)=>({number:i+1,text,unit:'段'}));}
  else if(ext==='.docx'){const mammoth=require('./vendor/mammoth.cjs');const result=await mammoth.extractRawText({arrayBuffer:new Uint8Array(buffer).buffer});pages=result.value.split(/\n\s*\n/).filter(Boolean).map((text,i)=>({number:i+1,text,unit:'段'}));}
  else if(ext==='.pdf'){const {PDFParse}=require('pdf-parse');const parser=new PDFParse({data:buffer});try{const result=await parser.getText();pages=result.pages.map(p=>({number:p.num,text:p.text,unit:'页'}));}finally{await parser.destroy();}}
  else throw new Error('支持 TXT、Markdown、文字型 PDF 和 DOCX');
  const full=pages.map(p=>p.text).join('\n\n');if(!full.trim())throw new Error('文件没有可提取文字；扫描件需要 OCR');
  let used=0;const kept=[];for(const p of pages){if(used>=2_000_000||kept.length>=2000)break;const text=p.text.slice(0,2_000_000-used);kept.push({...p,text});used+=text.length;}
  return {id:crypto.randomUUID(),name:path.basename(filename),body:kept.map(p=>p.text).join('\n\n').slice(0,2_000_000),pages:kept,truncated:used<full.length,updatedAt:new Date().toISOString()};
}
function retrieve(state,query,maxChars=14000){
  const segments=new Intl.Segmenter('zh-CN',{granularity:'word'}),terms=[...segments.segment(query)].filter(s=>s.isWordLike&&s.segment.length>1).map(s=>s.segment.toLowerCase());
  const candidates=[];
  for(const doc of state.docs){for(const page of doc.pages||[{number:1,text:doc.body,unit:'段'}]){for(let start=0;start<page.text.length;start+=1400){const text=page.text.slice(start,start+1800),lower=text.toLowerCase();const score=terms.reduce((n,t)=>n+(lower.includes(t)?t.length:0),0);if(score>0)candidates.push({docId:doc.id,name:doc.name,number:page.number,unit:page.unit||'段',text,score});}}}
  candidates.sort((a,b)=>b.score-a.score);let used=0;return candidates.filter(c=>{if(used+c.text.length>maxChars)return false;used+=c.text.length;return true}).slice(0,8);
}
module.exports={parseDocument,retrieve};
