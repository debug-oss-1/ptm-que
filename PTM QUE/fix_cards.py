with open('index.html', 'r', encoding='utf-8') as f:
    html = f.read()

start_marker = '  // Function to render queue cards with prominent queue number\n  function renderQueueCards(queues) {'
start_idx = html.find(start_marker)
if start_idx == -1:
    print('Start marker not found')
    exit(1)

end_marker = '  // Load user\'s joined queues'
end_idx = html.find(end_marker, start_idx)
if end_idx == -1:
    print('End marker not found')
    exit(1)

new_func = open('new_render.txt', 'r', encoding='utf-8').read()
html = html[:start_idx] + new_func + html[end_idx:]
with open('index.html', 'w', encoding='utf-8') as f:
    f.write(html)
print('Done. Separate cards implemented.')
