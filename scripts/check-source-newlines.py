from pathlib import Path
count = 0
for path in Path('src').rglob('*'):
    if not path.is_file():
        continue
    data = path.read_bytes()
    if b'\x00' in data:
        continue
    try:
        data.decode('utf-8')
    except UnicodeDecodeError:
        continue
    normalized = data.replace(b'\r\n', b'\n').replace(b'\r', b'\n').replace(b'\n', b'\r\n')
    if normalized != data:
        path.write_bytes(normalized)
        count += 1
    assert b'\n' not in path.read_bytes().replace(b'\r\n', b'')
print(f'Source CRLF verified; normalized {count} files')
