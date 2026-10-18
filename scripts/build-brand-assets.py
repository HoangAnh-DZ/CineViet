"""Reconstruct vector outlines from the user-supplied CineVjet reference board.

The icon is redrawn as cubic curves; the wordmark follows the primary
reference's outlines. Output contains paths, not pixels, fonts or board labels.
"""
from pathlib import Path
import sys
import numpy as np
from PIL import Image, ImageFilter


def simplify(points, tolerance=1.05):
    if len(points) < 3:
        return points
    a, b = np.array(points[0]), np.array(points[-1])
    delta = b - a
    values = np.array(points[1:-1]) - a
    if np.linalg.norm(delta):
        distances = np.abs(values[:, 0] * delta[1] - values[:, 1] * delta[0]) / np.linalg.norm(delta)
    else:
        distances = np.linalg.norm(values, axis=1)
    index = int(np.argmax(distances)) + 1
    if distances[index-1] <= tolerance:
        return [points[0], points[-1]]
    return simplify(points[:index+1], tolerance)[:-1] + simplify(points[index:], tolerance)


def unit(vector):
    length=np.linalg.norm(vector)
    return vector/length if length else np.array([1.,0.])


def fit_curve(points,left,right,tolerance=1.15):
    """Least-squares cubic fitting; retains scalable curves instead of pixel polygons."""
    p=np.asarray(points,dtype=float)
    if len(p)==2:
        distance=np.linalg.norm(p[1]-p[0])/3
        return [(p[0]+left*distance,p[1]+right*distance,p[1])]
    distances=np.r_[0,np.cumsum(np.linalg.norm(np.diff(p,axis=0),axis=1))]
    u=distances/distances[-1]
    b0=(1-u)**3;b1=3*u*(1-u)**2;b2=3*u*u*(1-u);b3=u**3
    a1=b1[:,None]*left;a2=b2[:,None]*right
    residual=p-(b0+b1)[:,None]*p[0]-(b2+b3)[:,None]*p[-1]
    matrix=np.array([[np.sum(a1*a1),np.sum(a1*a2)],[np.sum(a1*a2),np.sum(a2*a2)]])
    try: alpha=np.linalg.solve(matrix,np.array([np.sum(a1*residual),np.sum(a2*residual)]))
    except np.linalg.LinAlgError: alpha=np.array([-1.,-1.])
    if min(alpha)<1e-6 or max(alpha)>2*np.linalg.norm(p[-1]-p[0]): alpha[:]=np.linalg.norm(p[-1]-p[0])/3
    c1=p[0]+left*alpha[0];c2=p[-1]+right*alpha[1]
    curve=b0[:,None]*p[0]+b1[:,None]*c1+b2[:,None]*c2+b3[:,None]*p[-1]
    errors=np.sum((curve-p)**2,axis=1);split=int(np.argmax(errors))
    if errors[split]<=tolerance*tolerance: return [(c1,c2,p[-1])]
    split=max(1,min(len(p)-2,split))
    tangent=unit(p[split-1]-p[split+1])
    return fit_curve(p[:split+1],left,tangent,tolerance)+fit_curve(p[split:],-tangent,right,tolerance)


def outlines(mask):
    mask = np.asarray(Image.fromarray(mask.astype(np.uint8)*255).filter(ImageFilter.GaussianBlur(2.0))) >= 128
    edges = {}
    def add(a, b):
        edges.setdefault(a, []).append(b)
    height, width = mask.shape
    for y, x in zip(*np.where(mask)):
        x, y = int(x), int(y)
        if y == 0 or not mask[y-1, x]: add((x,y), (x+1,y))
        if x == width-1 or not mask[y, x+1]: add((x+1,y), (x+1,y+1))
        if y == height-1 or not mask[y+1, x]: add((x+1,y+1), (x,y+1))
        if x == 0 or not mask[y, x-1]: add((x,y+1), (x,y))
    paths = []
    while edges:
        start = next(iter(edges))
        points, current = [start], start
        while current in edges:
            following = edges[current].pop()
            if not edges[current]: del edges[current]
            current = following
            if current == start: break
            points.append(current)
        if len(points) < 12: continue
        area = abs(sum(points[i][0]*points[(i+1)%len(points)][1]-points[(i+1)%len(points)][0]*points[i][1] for i in range(len(points)))) / 2
        if area < 12: continue
        split = max(range(len(points)), key=lambda i: (points[i][0]-start[0])**2+(points[i][1]-start[1])**2)
        points=simplify(points[:split+1],1.3)[:-1]+simplify(points[split:]+[start],1.3)[:-1]
        p=np.asarray(points,dtype=float)
        corners=[i for i in range(len(p)) if np.dot(unit(p[i]-p[i-1]),unit(p[(i+1)%len(p)]-p[i]))<.65]
        if corners:
            p=np.roll(p,-corners[0],axis=0)
            corners=[(i-corners[0])%len(p) for i in corners]
            curves=[]
            for index,a in enumerate(corners):
                b=corners[index+1] if index+1<len(corners) else len(p)
                section=np.vstack([p,p[0]])[a:b+1]
                curves+=fit_curve(section,unit(section[1]-section[0]),unit(section[-2]-section[-1]),.85)
        else:
            split=int(np.argmax(np.sum((p-p[0])**2,axis=1)))
            tangent=unit(p[1]-p[-1]);middle=unit(p[split-1]-p[(split+1)%len(p)])
            curves=fit_curve(p[:split+1],tangent,middle,.85)+fit_curve(np.vstack([p[split:],p[0]]),-middle,-tangent,.85)
        path=f'M{p[0][0]:g} {p[0][1]:g}'
        for a,b,end in curves: path+=f'C{a[0]:.2f} {a[1]:.2f} {b[0]:.2f} {b[1]:.2f} {end[0]:g} {end[1]:g}'
        paths.append(path+'Z')
    return ''.join(paths)


source = np.asarray(Image.open(sys.argv[1]).convert('RGB'), dtype=np.int16)
assert source.shape[:2] == (1024, 1536), 'Use the original supplied reference board.'
# Local coordinates: x=110..850, y=115..330. These bounds exclude the tagline.
icon = source[115:330, 110:310]
word = source[160:294, 328:850]
red = lambda a: (a[:,:,0]>70)&(a[:,:,0]>a[:,:,1]*1.8)&(a[:,:,0]>a[:,:,2]*1.5)
white = lambda a: (a.min(axis=2)>145)&((a.max(axis=2)-a.min(axis=2))<45)
icon_red, icon_white = outlines(red(icon)), outlines(white(icon))
word_white, word_red = outlines(white(word)), outlines(red(word))
assert all([icon_red, icon_white, word_white, word_red])
defs = '<defs><linearGradient id="red" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#ff3541"/><stop offset=".5" stop-color="#fa2036"/><stop offset="1" stop-color="#e9142f"/></linearGradient><linearGradient id="fold" x1="0" y1="0" x2="1" y2=".2"><stop stop-color="#cb1033"/><stop offset="1" stop-color="#8d102b"/></linearGradient></defs>'
def icon_group(ink):
    return f'<path d="M88 11C103 9 115 13 128 21L182 53Q190 58 183 63L151 82Q144 88 137 84L105 65C81 50 55 57 55 86V130C55 153 77 170 101 159L138 140Q145 136 151 140L182 158Q190 163 183 169L129 201C109 213 90 213 70 201L34 180C18 171 11 154 11 136V88C11 65 17 49 35 38L70 17Q80 12 88 11Z" fill="url(#red)"/><path d="M11 103C12 66 53 43 91 58L105 65C77 52 55 64 55 86V130C55 153 77 170 101 159L78 172C42 178 11 150 11 124Z" fill="url(#fold)"/><path d="M80 89C80 81 85 78 92 82L125 103C134 108 134 115 125 120L92 139C85 143 80 140 80 132Z" fill="{ink}"/>'
def word_group(ink):
    return f'<path d="{word_white}" fill="{ink}" fill-rule="evenodd"/><path d="{word_red}" fill="#fa2439" fill-rule="evenodd"/>'
def svg(viewbox, content, label='CineVjet'):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{viewbox}" role="img" aria-label="{label}">{defs}{content}</svg>\n'
target = Path('public/brand'); target.mkdir(parents=True, exist_ok=True)
for theme, ink in [('dark','#f5f5f7'),('light','#0b1020')]:
    full = '<g transform="translate(0 0)">'+icon_group(ink)+'</g><g transform="translate(218 45)">'+word_group(ink)+'</g>'
    (target/f'cinevjet-logo-{theme}.svg').write_text(svg('0 0 740 215',full), encoding='utf8')
    (target/f'cinevjet-wordmark-{theme}.svg').write_text(svg('0 0 522 134',word_group(ink)), encoding='utf8')
icon_svg=svg('0 0 224 224','<g transform="translate(12 4)">'+icon_group('#f5f5f7')+'</g>')
(target/'cinevjet-icon.svg').write_text(icon_svg,encoding='utf8')
Path('src/app/icon.svg').write_text(icon_svg,encoding='utf8')
print('Created path-only SVG logo, wordmark (dark/light), and square icon from supplied reference.')
