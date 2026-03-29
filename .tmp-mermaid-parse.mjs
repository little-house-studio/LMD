import mermaid from './node_modules/mermaid/dist/mermaid.core.mjs';
const cases = [
  `flowchart LR\n  产品说明_a7c["整理需求与范围"]\n  评审完成_p4k["通过"]\n  产品说明_a7c --> 评审完成_p4k`,
  `flowchart LR\n  product_desc_a7c["产品说明<br/>整理需求与范围"]\n  review_done_p4k["评审完成<br/>通过"]\n  product_desc_a7c --> review_done_p4k`
];
for (const [index, source] of cases.entries()) {
  try {
    await mermaid.parse(source);
    console.log(`case${index+1}:ok`);
  } catch (error) {
    console.log(`case${index+1}:fail`);
    console.log(error?.message || String(error));
  }
}
