#!/usr/bin/env python3
# eyemask.py — 遮 AI 虚构脸过 Seedance 真人闸。v2: 黑块改羽化高斯模糊(读作虚焦,不可被当图形复制)。
#   lvl1: 眼带+嘴带(默认)   lvl2: 眼到嘴整条中脸大带 + 更强模糊
#   eyemask.py b1.jpg ... [--level N] | --dir DIR [--level N] | IN --out OUT [--level N]
import sys, os, json, glob, cv2, numpy as np
MODEL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "face_detection_yunet_2023mar.onnx")
HAAR = ['haarcascade_frontalface_default.xml','haarcascade_frontalface_alt2.xml','haarcascade_profileface.xml']
def yunet_faces(img):
    h,w=img.shape[:2]
    det=cv2.FaceDetectorYN.create(MODEL,"",(w,h),0.45,0.3,5000); det.setInputSize((w,h))
    _,faces=det.detect(img); out=[]
    if faces is not None:
        for f in faces:
            x,y,bw,bh=[int(v) for v in f[:4]]
            out.append((x,y,bw,bh,(float(f[4]),float(f[5])),(float(f[6]),float(f[7])),(float(f[10]),float(f[11])),(float(f[12]),float(f[13]))))
    return out
def haar_boxes(gray):
    hc=cv2.data.haarcascades; boxes=[]
    for c in HAAR:
        fc=cv2.CascadeClassifier(hc+c)
        for b in fc.detectMultiScale(gray,1.1,4,minSize=(24,24)):
            x,y,w,h=[int(v) for v in b]; boxes.append((x,y,w,h,None,None,None,None))
    h,w=gray.shape; fc=cv2.CascadeClassifier(hc+'haarcascade_profileface.xml')
    for (x,y,bw,bh) in fc.detectMultiScale(cv2.flip(gray,1),1.1,4,minSize=(24,24)):
        boxes.append((w-int(x)-int(bw),int(y),int(bw),int(bh),None,None,None,None))
    return boxes
def mask_one(path,out,level=1):
    img=cv2.imread(path)
    if img is None: return {"file":path,"ok":False,"error":"read"}
    H,W=img.shape[:2]; used="haar"; faces=[]
    if os.path.exists(MODEL) and os.path.getsize(MODEL)>100000:
        try: faces=yunet_faces(img); used="yunet"
        except Exception as e: used="haar(yunet_err:"+str(e)[:40]+")"
    # IoU 合并:两检测器都跑,重叠框(同一张脸)去重,独有框(如 yunet 漏的侧脸)保留
    hb=haar_boxes(cv2.cvtColor(img,cv2.COLOR_BGR2GRAY))
    def _iou(a,b):
        ax2,ay2,bx2,by2=a[0]+a[2],a[1]+a[3],b[0]+b[2],b[1]+b[3]
        ix1,iy1,ix2,iy2=max(a[0],b[0]),max(a[1],b[1]),min(ax2,bx2),min(ay2,by2)
        iw,ih=max(0,ix2-ix1),max(0,iy2-iy1); inter=iw*ih
        ua=a[2]*a[3]+b[2]*b[3]-inter
        return inter/ua if ua>0 else 0
    for hbx in hb:
        if not any(_iou(hbx,fx)>0.3 for fx in faces): faces.append(hbx)
    acc=np.zeros((H,W),np.float32)
    def blk(x1,y1,x2,y2):
        x1=max(0,int(x1)); y1=max(0,int(y1)); x2=min(W,int(x2)); y2=min(H,int(y2))
        if x2<=x1 or y2<=y1: return
        cv2.ellipse(acc,((x1+x2)//2,(y1+y2)//2),(max(3,int((x2-x1)*0.62)),max(3,int((y2-y1)*0.82))),0,0,360,1.0,-1)
    for (x,y,w,h,re,le,mr,ml) in faces:
        if level>=2:
            if re and le and mr and ml:
                ey=min(re[1],le[1]); my=max(mr[1],ml[1]); xs=[re[0],le[0],mr[0],ml[0]]
                blk(min(xs)-0.24*w, ey-0.18*h, max(xs)+0.24*w, my+0.16*h)
            else:
                blk(x-0.08*w, y+0.10*h, x+w+0.08*w, y+0.86*h)
        else:
            if re and le:
                cy=(re[1]+le[1])/2.0; half=max(h*0.20,16)
                blk(min(re[0],le[0])-0.18*w, cy-half*0.7, max(re[0],le[0])+0.18*w, cy+half*0.8)
            else:
                blk(x-0.05*w, y+0.14*h, x+w+0.05*w, y+0.52*h)
            if mr and ml:
                my=(mr[1]+ml[1])/2.0; mh=max(h*0.16,14)
                blk(min(mr[0],ml[0])-0.18*w, my-mh*0.8, max(mr[0],ml[0])+0.18*w, my+mh*0.9)
            else:
                blk(x-0.05*w, y+0.60*h, x+w+0.05*w, y+0.88*h)
    if faces:
        maxw=max(f[2] for f in faces)
        bk=int(maxw*(0.9 if level<2 else 1.4)); bk=max(31,bk|1)
        blurred=cv2.GaussianBlur(img,(bk,bk),0); blurred=cv2.GaussianBlur(blurred,(bk,bk),0)
        fk=max(9,int(maxw*0.25)|1)
        soft=np.clip(cv2.GaussianBlur(acc,(fk,fk),0),0,1)[...,None]
        img=(img.astype(np.float32)*(1.0-soft)+blurred.astype(np.float32)*soft).astype(np.uint8)
    cv2.imwrite(out,img)
    return {"file":os.path.basename(path),"ok":True,"faces":len(faces),"masked":bool(faces),"detector":used,"level":level,"mode":"blur"}
def outname(p): b,e=os.path.splitext(p); return b+".masked"+e
def main():
    a=sys.argv[1:]; level=1
    if "--level" in a: i=a.index("--level"); level=int(a[i+1]); a=a[:i]+a[i+2:]
    if not a: print(json.dumps({"ok":False,"error":"usage: b1.jpg ... [--level N] | --dir DIR | IN --out OUT"})); return
    if a[0]=="--dir":
        files=sorted(f for ext in ("*.jpg","*.jpeg","*.png") for f in glob.glob(os.path.join(a[1],ext)) if ".masked." not in f)
        jobs=[(f,outname(f)) for f in files]
    elif "--out" in a:
        i=a.index("--out"); jobs=[(a[0],a[i+1])]
    else:
        jobs=[(f,outname(f)) for f in a]
    res=[mask_one(i,o,level) for (i,o) in jobs]
    print(json.dumps({"ok":True,"count":len(res),"total_faces":sum(r.get("faces",0) for r in res if r.get("ok")),"results":res},ensure_ascii=False))
main()
