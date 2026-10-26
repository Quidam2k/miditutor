"""Join homr's one-part-per-page MusicXML into one piece (pages in reading order, #9486).

Usage: merge_omr_pages.py OUT TITLE PAGE.musicxml... Output stays under Q:/Personal, never the repo.
"""
import sys
import xml.etree.ElementTree as ET

out, title, pages = sys.argv[1], sys.argv[2], sys.argv[3:]
tree = ET.parse(pages[0])
root = tree.getroot()
part = root.find('part')
number = len(part.findall('measure'))
for page in pages[1:]:
    for measure in ET.parse(page).getroot().find('part').findall('measure'):
        number += 1
        measure.set('number', str(number))
        part.append(measure)
work = root.find('work')
if work is None:
    work = ET.Element('work')
    root.insert(0, work)
heading = work.find('work-title')
if heading is None:
    heading = ET.SubElement(work, 'work-title')
heading.text = title
tree.write(out, encoding='utf-8', xml_declaration=True)
print(out, number, 'bars')
