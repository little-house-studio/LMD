import"./chunk-XZSTWKYB-C2I8AQqI.js";import{r as e}from"./chunk-GEFDOKGD-BWOOSym7.js";import"./chunk-R5LLSJPH-D_Qtv0V4.js";import"./chunk-7E7YKBS2-B1Qdh1EQ.js";import"./chunk-EGIJ26TM-do8qoI23.js";import"./chunk-C72U2L5F-B9xGJYs2.js";import"./chunk-XIRO2GV7-Bhf3O1q4.js";import"./chunk-L3YUKLVL-DqZkI1zg.js";import"./chunk-OZEHJAEY-CrI_8vgv.js";import{g as t,h as n}from"./src-Bo7sEYAv.js";import{B as r,C as i,V as a,W as o,_ as s,a as c,c as l,d as u,v as d,y as f}from"./chunk-7R4GIKGN-BKQ9dgf2.js";import{t as p}from"./chunk-HHEYEP7N-6rGU6oV1.js";import"./dist-CYhTSvsw.js";import{t as m}from"./chunk-4BX2VUAB-DcHKZuir.js";import{t as h}from"./mermaid-parser.core-Tvu06Sjv.js";var g,_=u.packet,v=(g=class{constructor(){this.packet=[],this.setAccTitle=a,this.getAccTitle=d,this.setDiagramTitle=o,this.getDiagramTitle=i,this.getAccDescription=s,this.setAccDescription=r}getConfig(){let t=e({..._,...f().packet});return t.showBits&&(t.paddingY+=10),t}getPacket(){return this.packet}pushWord(e){e.length>0&&this.packet.push(e)}clear(){c(),this.packet=[]}},n(g,`PacketDB`),g),y=1e4,b=n((e,n)=>{m(e,n);let r=-1,i=[],a=1,{bitsPerRow:o}=n.getConfig();for(let{start:s,end:c,bits:l,label:u}of e.blocks){if(s!==void 0&&c!==void 0&&c<s)throw Error(`Packet block ${s} - ${c} is invalid. End must be greater than start.`);if(s??(s=r+1),s!==r+1)throw Error(`Packet block ${s} - ${c??s} is not contiguous. It should start from ${r+1}.`);if(l===0)throw Error(`Packet block ${s} is invalid. Cannot have a zero bit field.`);for(c??(c=s+(l??1)-1),l??(l=c-s+1),r=c,t.debug(`Packet block ${s} - ${r} with label ${u}`);i.length<=o+1&&n.getPacket().length<y;){let[e,t]=x({start:s,end:c,bits:l,label:u},a,o);if(i.push(e),e.end+1===a*o&&(n.pushWord(i),i=[],a++),!t)break;({start:s,end:c,bits:l,label:u}=t)}}n.pushWord(i)},`populate`),x=n((e,t,n)=>{if(e.start===void 0)throw Error(`start should have been set during first phase`);if(e.end===void 0)throw Error(`end should have been set during first phase`);if(e.start>e.end)throw Error(`Block start ${e.start} is greater than block end ${e.end}.`);if(e.end+1<=t*n)return[e,void 0];let r=t*n-1,i=t*n;return[{start:e.start,end:r,label:e.label,bits:r-e.start},{start:i,end:e.end,label:e.label,bits:e.end-i}]},`getNextFittingBlock`),S={parser:{yy:void 0},parse:n(async e=>{let n=await h(`packet`,e),r=S.parser?.yy;if(!(r instanceof v))throw Error(`parser.parser?.yy was not a PacketDB. This is due to a bug within Mermaid, please report this issue at https://github.com/mermaid-js/mermaid/issues.`);t.debug(n),b(n,r)},`parse`)},C=n((e,t,n,r)=>{let i=r.db,a=i.getConfig(),{rowHeight:o,paddingY:s,bitWidth:c,bitsPerRow:u}=a,d=i.getPacket(),f=i.getDiagramTitle(),m=o+s,h=m*(d.length+1)-(f?0:o),g=c*u+2,_=p(t);_.attr(`viewBox`,`0 0 ${g} ${h}`),l(_,h,g,a.useMaxWidth);for(let[e,t]of d.entries())w(_,t,e,a);_.append(`text`).text(f).attr(`x`,g/2).attr(`y`,h-m/2).attr(`dominant-baseline`,`middle`).attr(`text-anchor`,`middle`).attr(`class`,`packetTitle`)},`draw`),w=n((e,t,n,{rowHeight:r,paddingX:i,paddingY:a,bitWidth:o,bitsPerRow:s,showBits:c})=>{let l=e.append(`g`),u=n*(r+a)+a;for(let e of t){let t=e.start%s*o+1,n=(e.end-e.start+1)*o-i;if(l.append(`rect`).attr(`x`,t).attr(`y`,u).attr(`width`,n).attr(`height`,r).attr(`class`,`packetBlock`),l.append(`text`).attr(`x`,t+n/2).attr(`y`,u+r/2).attr(`class`,`packetLabel`).attr(`dominant-baseline`,`middle`).attr(`text-anchor`,`middle`).text(e.label),!c)continue;let a=e.end===e.start,d=u-2;l.append(`text`).attr(`x`,t+(a?n/2:0)).attr(`y`,d).attr(`class`,`packetByte start`).attr(`dominant-baseline`,`auto`).attr(`text-anchor`,a?`middle`:`start`).text(e.start),a||l.append(`text`).attr(`x`,t+n).attr(`y`,d).attr(`class`,`packetByte end`).attr(`dominant-baseline`,`auto`).attr(`text-anchor`,`end`).text(e.end)}},`drawWord`),T={draw:C},E={byteFontSize:`10px`,startByteColor:`black`,endByteColor:`black`,labelColor:`black`,labelFontSize:`12px`,titleColor:`black`,titleFontSize:`14px`,blockStrokeColor:`black`,blockStrokeWidth:`1`,blockFillColor:`#efefef`},D={parser:S,get db(){return new v},renderer:T,styles:n(({packet:t}={})=>{let n=e(E,t);return`
	.packetByte {
		font-size: ${n.byteFontSize};
	}
	.packetByte.start {
		fill: ${n.startByteColor};
	}
	.packetByte.end {
		fill: ${n.endByteColor};
	}
	.packetLabel {
		fill: ${n.labelColor};
		font-size: ${n.labelFontSize};
	}
	.packetTitle {
		fill: ${n.titleColor};
		font-size: ${n.titleFontSize};
	}
	.packetBlock {
		stroke: ${n.blockStrokeColor};
		stroke-width: ${n.blockStrokeWidth};
		fill: ${n.blockFillColor};
	}
	`},`styles`)};export{D as diagram};