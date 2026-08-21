# -*- coding: utf-8 -*-
"""
교과서 해당 쪽을 모바일 뷰어용 WebP 로 굽는다.

원본 PDF 는 이 저장소 밖(강의 폴더의 research/)에 있고, 저작물이므로 커밋하지 않는다.
결과물만 materials/tb/ 에 남는다.

    python tools/render-textbook.py

확인된 사실: 두 교과서 모두 PDF 페이지 번호 == 인쇄된 쪽번호 (오프셋 0).
"""
import os
import fitz
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
RESEARCH = os.path.join(os.path.dirname(REPO), 'research')
OUT = os.path.join(REPO, 'materials', 'tb')

DPI = 200
QUALITY = 80
FONT = r'C:\Windows\Fonts\malgun.ttf'

BOOKS = {
    'a': {
        'title': '독서 토론과 글쓰기',
        'pdf': os.path.join(RESEARCH, '독서 토론과 글쓰기',
                            '지학사_2022개정_고_독서 토론과 글쓰기_교과서(pdf).pdf'),
        'pages': [80, 81, 82, 91, 92, 93],
    },
    'b': {
        'title': '주제 탐구 독서',
        'pdf': os.path.join(RESEARCH, '주제 탐구 독서',
                            '지학사_2022개정_고_주제 탐구 독서_교과서(pdf).pdf'),
        'pages': [215, 216, 217, 218, 219],
    },
}


def stamp(img, text):
    """페이지 아래에 띠를 덧대고 출처·배포 금지 문구를 새긴다 (본문을 가리지 않는다)."""
    band = max(38, img.height // 46)
    out = Image.new('RGB', (img.width, img.height + band), '#ffffff')
    out.paste(img, (0, 0))
    d = ImageDraw.Draw(out)
    d.line([(0, img.height), (img.width, img.height)], fill='#d8d2c4', width=2)
    size = int(band * 0.52)
    try:
        font = ImageFont.truetype(FONT, size)
    except OSError:
        font = ImageFont.load_default()
    d.text((img.width // 2, img.height + band // 2), text,
           font=font, fill='#8b8375', anchor='mm')
    return out


def main():
    os.makedirs(OUT, exist_ok=True)
    total = 0
    for code, bk in BOOKS.items():
        doc = fitz.open(bk['pdf'])
        for n in bk['pages']:
            pix = doc[n - 1].get_pixmap(dpi=DPI)
            img = Image.frombytes('RGB', (pix.width, pix.height), pix.samples)
            img = stamp(img, '2026 지학사 국어과 연수 자료 · 「%s」 %d쪽 · 무단 배포 금지'
                        % (bk['title'], n))
            path = os.path.join(OUT, '%s-%d.webp' % (code, n))
            img.save(path, format='WEBP', quality=QUALITY, method=5)
            kb = os.path.getsize(path) / 1024
            total += kb
            print('%s-%d.webp  %dx%d  %dKB' % (code, n, img.width, img.height, round(kb)))
        doc.close()
    print('합계 %dKB / %d장' % (round(total), sum(len(b['pages']) for b in BOOKS.values())))


if __name__ == '__main__':
    main()
