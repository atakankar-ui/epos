// Getting bytes to the receipt printer. Three ways, none needing anything extra installed:
//   network  straight to the printer over the shop's network (port 9100)
//   system   a printer installed in Windows, sent "raw" through Windows' own print system
//   (tests)  TILL_PRINT_TO_FILE=<folder> writes each job to a file instead of printing
import { connect } from 'node:net'
import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PrinterChoice } from '../shared/hardware'

function sendToNetwork(host: string, port: number, bytes: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port })
    const fail = (message: string) => { socket.destroy(); reject(new Error(message)) }
    socket.setTimeout(4000, () => fail(`The printer at ${host} did not answer. Is it switched on and on the network?`))
    socket.once('error', (err: NodeJS.ErrnoException) => fail(
      err.code === 'ECONNREFUSED' ? `Something answered at ${host} but refused the print job. Check the address and port.`
        : err.code === 'ENOTFOUND' ? `No device called ${host} was found on the network.`
          : `Could not reach the printer at ${host} (${err.code ?? err.message}).`))
    socket.once('connect', () => socket.end(Buffer.from(bytes), () => resolve()))
  })
}

// Windows keeps a queue for every installed printer. This hands it our bytes untouched
// ("RAW"), using the same Windows call any till software uses, through PowerShell.
const WINDOWS_RAW_PRINT = String.raw`
param([string]$PrinterName, [string]$DataFile)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class TillRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOCINFOW {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }
  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  static extern int StartDocPrinter(IntPtr handle, int level, [In] DOCINFOW info);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool WritePrinter(IntPtr handle, byte[] bytes, int count, out int written);
  public static void Send(string printer, byte[] bytes) {
    IntPtr handle;
    if (!OpenPrinter(printer, out handle, IntPtr.Zero)) throw new Exception("Windows could not open the printer (error " + Marshal.GetLastWin32Error() + ").");
    try {
      DOCINFOW info = new DOCINFOW();
      info.pDocName = "Till receipt"; info.pDataType = "RAW";
      if (StartDocPrinter(handle, 1, info) == 0) throw new Exception("Windows could not start the print job (error " + Marshal.GetLastWin32Error() + ").");
      try {
        if (!StartPagePrinter(handle)) throw new Exception("Windows could not start the page (error " + Marshal.GetLastWin32Error() + ").");
        int written;
        bool ok = WritePrinter(handle, bytes, bytes.Length, out written);
        int error = Marshal.GetLastWin32Error();
        EndPagePrinter(handle);
        if (!ok || written != bytes.Length) throw new Exception("Windows could not send the receipt to the printer (error " + error + ").");
      } finally { EndDocPrinter(handle); }
    } finally { ClosePrinter(handle); }
  }
}
"@
[TillRawPrinter]::Send($PrinterName, [System.IO.File]::ReadAllBytes($DataFile))
`

function run(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    // Arguments go as a list, never through a shell, so a printer's name cannot be read as a command.
    execFile(command, args, { timeout: 15000, windowsHide: true }, (error, _stdout, stderr) => {
      if (!error) return resolve()
      const detail = String(stderr || error.message).split('\n').map((l) => l.trim()).filter(Boolean)
      const line = detail.find((l) => /Windows could not|error|not found|unknown|No such/i.test(l)) ?? detail[0] ?? 'unknown problem'
      reject(new Error(line.replace(/^.*Exception calling "Send" with "2" argument\(s\): "?/, '').replace(/"$/, '')))
    })
  })
}

async function sendToSystemPrinter(name: string, bytes: Uint8Array): Promise<void> {
  const folder = await mkdtemp(join(tmpdir(), 'till-print-'))
  try {
    const data = join(folder, 'job.bin')
    await writeFile(data, bytes)
    if (process.platform === 'win32') {
      const script = join(folder, 'print.ps1')
      await writeFile(script, WINDOWS_RAW_PRINT, 'utf8')
      await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, name, data])
    } else {
      await run('lp', ['-d', name, '-o', 'raw', data]) // Mac and Linux, for trying things out
    }
  } finally {
    await rm(folder, { recursive: true, force: true })
  }
}

let fileJob = 0

export async function sendToPrinter(printer: PrinterChoice, bytes: Uint8Array): Promise<void> {
  if (printer.kind === 'none') throw new Error('No printer has been chosen yet. Choose one in Setup.')
  const testFolder = process.env.TILL_PRINT_TO_FILE
  if (testFolder) {
    await writeFile(join(testFolder, `job-${String(++fileJob).padStart(3, '0')}.bin`), bytes)
    return
  }
  if (printer.kind === 'network') return sendToNetwork(printer.host, printer.port, bytes)
  return sendToSystemPrinter(printer.name, bytes)
}
