namespace MediaHub.ViewerService;

using System.IO.Pipes;
using System.Text.Json;

public sealed class ConsoleViewerProgram
{
    private readonly string _pipeName;

    [System.Runtime.InteropServices.DllImport("kernel32.dll")]
    private static extern IntPtr GetStdHandle(int nStdHandle);

    [System.Runtime.InteropServices.DllImport("kernel32.dll")]
    private static extern bool GetConsoleMode(IntPtr hConsoleHandle, out uint lpMode);

    [System.Runtime.InteropServices.DllImport("kernel32.dll")]
    private static extern bool SetConsoleMode(IntPtr hConsoleHandle, uint dwMode);

    public ConsoleViewerProgram(string pipeName)
    {
        _pipeName = pipeName;
    }

    private static void EnableVirtualTerminalProcessing()
    {
        if (!OperatingSystem.IsWindows())
            return;

        var handle = GetStdHandle(-11);
        if (!GetConsoleMode(handle, out uint mode))
            return;

        SetConsoleMode(handle, mode | 0x0004);
    }

    public static bool IsViewer(string[] args)
    {
        return args.Contains(ConsoleViewerClient.ViewerArgName);
    }

    public static async Task FromArgsAsync(string[] args)
    {
        string pipeName = args[Array.IndexOf(args, ConsoleViewerClient.PipeArgName) + 1];
        await new ConsoleViewerProgram(pipeName).RunAsync();
    }

    public async Task RunAsync(CancellationToken ct = default)
    {
        EnableVirtualTerminalProcessing();

        using var pipe = new NamedPipeClientStream(
            ".",
            _pipeName,
            PipeDirection.InOut,
            PipeOptions.Asynchronous);

        await pipe.ConnectAsync(ct);

        using var reader = new StreamReader(pipe);
        using var writer = new StreamWriter(pipe) { AutoFlush = true };

        await SendAsync(writer, new ViewerMessage(ViewerMessageTypes.Started), ct);

        var inputTask = Task.Run(async () =>
        {
            while (!ct.IsCancellationRequested)
            {
                string? line = Console.ReadLine();
                if (line is null)
                    break;

                await SendAsync(writer, new ViewerMessage(
                    ViewerMessageTypes.Input,
                    line), ct);
            }
        }, ct);

        while (!ct.IsCancellationRequested)
        {
            string? json = await reader.ReadLineAsync(ct);
            if (json is null)
                break;

            var msg = JsonSerializer.Deserialize<ViewerMessage>(json);
            if (msg is null)
                continue;

            switch (msg.Type)
            {
                case ViewerMessageTypes.Write:
                    Console.Write(msg.Message);
                    break;

                case ViewerMessageTypes.WriteLine:
                    Console.WriteLine(msg.Message);
                    break;

                case ViewerMessageTypes.Error:
                    Console.Error.Write(msg.Message);
                    break;

                case ViewerMessageTypes.ErrorLine:
                    Console.Error.WriteLine(msg.Message);
                    break;

                case ViewerMessageTypes.Clear:
                    Console.Clear();
                    break;

                case ViewerMessageTypes.Exit:
                    await SendAsync(writer, new ViewerMessage(ViewerMessageTypes.Exited), ct);
                    return;
            }
        }
    }

    private static Task SendAsync(
        StreamWriter writer,
        ViewerMessage msg,
        CancellationToken ct)
    {
        string json = JsonSerializer.Serialize(msg);
        return writer.WriteLineAsync(json.AsMemory(), ct);
    }
}