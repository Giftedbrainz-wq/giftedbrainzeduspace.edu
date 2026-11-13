/* Compress before upload: 256x256 max, WebP, 60 KB server-side cap. */
window.GBCompactImage=async(file)=>{
 if(!file||!/^image\/(png|jpeg|webp)$/.test(file.type)||file.size>6*1024*1024)throw Error('Choose a PNG, JPEG or WebP picture smaller than 6 MB.');
 const url=URL.createObjectURL(file);try{
  const picture=new Image();picture.src=url;await picture.decode();
  for(const [dimension,quality] of [[256,.72],[220,.62],[176,.50]]){
   const canvas=document.createElement('canvas');canvas.width=canvas.height=dimension;
   const ctx=canvas.getContext('2d');const scale=Math.max(dimension/picture.naturalWidth,dimension/picture.naturalHeight);
   const w=picture.naturalWidth*scale,h=picture.naturalHeight*scale;
   ctx.drawImage(picture,(dimension-w)/2,(dimension-h)/2,w,h);
   const data=canvas.toDataURL('image/webp',quality);
   if(data.startsWith('data:image/webp;')&&data.length<78000)return data;
  }
  throw Error('This picture is too detailed to compress. Try another image.');
 }finally{URL.revokeObjectURL(url)}
};
