const win = (path: string) => path.replaceAll('/', '\\')

// Commands run in the project root on relative paths, so only the separators differ on Windows.
export const moveCommands = (root: string, from: string, to: string, dir: string) => {
  if (!/^[A-Za-z]:|\\/.test(root)) {
    return [
      ['mkdir', '-p', dir],
      ['mv', from, to],
    ]
  }
  return [
    ['cmd', '/c', 'if', 'not', 'exist', win(dir), 'mkdir', win(dir)],
    ['cmd', '/c', 'move', win(from), win(to)],
  ]
}
