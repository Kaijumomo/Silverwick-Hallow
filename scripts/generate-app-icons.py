# Regenerates public/icons/* from the master app-icon artwork (rounded square on black).
# Usage: python3 -I scripts/generate-app-icons.py <master.png> public/icons  (needs Pillow, numpy)
import sys
from PIL import Image, ImageFilter
import numpy as np
from PIL import ImageDraw
src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGB')
a = np.array(im).astype(int).sum(2)
# outside = near-black region connected to the image corners
mask = Image.fromarray(np.stack([((a < 14)*255).astype('uint8')]*3, 2))
for c in ((0,0),(mask.width-1,0),(0,mask.height-1),(mask.width-1,mask.height-1)):
    ImageDraw.floodfill(mask, c, (255,0,0))
outside = (np.array(mask)[:,:,1] == 0) & (np.array(mask)[:,:,0] == 255)
alpha = Image.fromarray(((~outside)*255).astype('uint8')).filter(ImageFilter.GaussianBlur(1.2))
rgba = im.copy(); rgba.putalpha(alpha)
box = (73, 66, 1181, 1166)  # rounded-square bounds
cx, cy = (box[0]+box[2])//2, (box[1]+box[3])//2
half = 554
sq = rgba.crop((cx-half, cy-half, cx+half, cy+half))
import os; os.makedirs(out, exist_ok=True)
for n, name in ((192,'icon-192.png'),(512,'icon-512.png'),(180,'apple-touch-icon.png'),(32,'favicon-32.png')):
    s = sq.resize((n, n), Image.LANCZOS)
    if name == 'apple-touch-icon.png':  # iOS applies its own mask; supply opaque full-bleed
        bg = Image.new('RGB', s.size, (4, 7, 12)); bg.paste(s, mask=s.split()[3]); s = bg
    s.save(f"{out}/{name}", optimize=True)
# maskable: full-bleed art inset past the rounded corners, mark kept inside the 80% safe circle
inset = 462
mk = im.crop((cx-inset, cy-inset, cx+inset, cy+inset)).resize((512,512), Image.LANCZOS)
mk.save(f"{out}/icon-maskable-512.png", optimize=True)
mk.resize((192,192), Image.LANCZOS).save(f"{out}/icon-maskable-192.png", optimize=True)
