import {createHash} from 'node:crypto'
export interface PageQuery {resource:string;revision?:string;offset?:number;limit?:number}
export interface ContextPage {resource:string;revision:string;offset:number;totalChars:number;nextOffset:number|null;text:string}

export function pageText(query:PageQuery, workRevision:number, value:string):ContextPage {
  const offset=query.offset ?? 0
  const limit=query.limit ?? 4000
  if (!Number.isSafeInteger(offset) || offset<0 || !Number.isSafeInteger(limit) || limit<1 || limit>8000) throw new Error('invalid-page')
  if (offset && !query.revision) throw new Error('revision-required')
  const revision=createHash('sha256').update(JSON.stringify([query.resource,workRevision,value])).digest('hex')
  if (query.revision!==undefined && query.revision!==revision) throw new Error('revision-changed')
  if (offset>value.length) throw new Error('offset-out-of-range')
  const end=Math.min(value.length,offset+limit)
  return {resource:query.resource,revision,offset,totalChars:value.length,nextOffset:end<value.length?end:null,text:value.slice(offset,end)}
}

export class ContextBudget {
  private readonly usages=new WeakMap<object,{turn:number;pages:number;chars:number}>()
  charge(agent:object,turn:number,chars:number):void {
    if(!Number.isSafeInteger(turn)||turn<0) throw new Error('no-active-turn')
    const last=this.usages.get(agent)
    const used=last?.turn===turn ? last : {turn,pages:0,chars:0}
    if(used.pages>=8 || used.chars+chars>32768) throw new Error('read-budget-exhausted')
    used.pages++
    used.chars+=chars
    this.usages.set(agent,used)
  }
}
