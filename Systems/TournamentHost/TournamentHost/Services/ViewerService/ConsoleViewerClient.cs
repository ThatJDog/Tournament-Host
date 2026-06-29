namespace MediaHub.ViewerService;

using System.Diagnostics;
using System.IO.Pipes;
using System.Text.Json;
using System.Threading.Channels;

public sealed class ConsoleViewerClient : IAsyncDisposable
{
    public const string ViewerArgName = "--cviewer";
    public const string PipeArgName = "--vpipe";

    public static string DefaultEnvPath = Environment.ProcessPath!;

    private readonly string _pipeName = "viewer-" + Guid.NewGuid();
    private readonly Channel<string> _inputChannel = Channel.CreateUnbounded<string>();

    private NamedPipeServerStream? _pipe;
    private StreamReader? _reader;
    private StreamWriter? _writer;
    private Process? _process;
    private CancellationTokenSource? _cts;
    private Task? _readLoopTask;

    private readonly SemaphoreSlim _sendLock = new(1, 1);
    private volatile bool _closed;

    public bool IsClosed => _closed;

    public event Action<string>? InputReceived;
    public event Action<ViewerMessage>? MessageReceived;
    public event Action? Closed;

    public async Task StartAsync(string? exePath = null, CancellationToken ct = default)
    {
        if (exePath == null)
            exePath = DefaultEnvPath;

        _cts = CancellationTokenSource.CreateLinkedTokenSource(ct);

        _pipe = new NamedPipeServerStream(
            _pipeName,
            PipeDirection.InOut,
            1,
            PipeTransmissionMode.Byte,
            PipeOptions.Asynchronous);

        _process = Process.Start(new ProcessStartInfo
        {
            FileName = exePath,
            Arguments = $"{ViewerArgName} {PipeArgName} {_pipeName}",
            UseShellExecute = true,
            CreateNoWindow = false
        });

        await _pipe.WaitForConnectionAsync(_cts.Token);

        _reader = new StreamReader(_pipe);
        _writer = new StreamWriter(_pipe) { AutoFlush = true };

        _readLoopTask = Task.Run(ReadLoopAsync);
    }

    public Task<bool> WriteRawAsync(string text) =>
        TrySendAsync(new ViewerMessage(ViewerMessageTypes.Write, text));

    public Task<bool> WriteAsync(string text) =>
        TrySendAsync(new ViewerMessage(ViewerMessageTypes.Write, text));

    public Task<bool> WriteLineAsync(string text = "") =>
        TrySendAsync(new ViewerMessage(ViewerMessageTypes.WriteLine, text));

    public Task<bool> ErrorAsync(string text) =>
        TrySendAsync(new ViewerMessage(ViewerMessageTypes.Error, text));

    public Task<bool> ErrorLineAsync(string text = "") =>
        TrySendAsync(new ViewerMessage(ViewerMessageTypes.ErrorLine, text));

    public Task<bool> ClearAsync() =>
        TrySendAsync(new ViewerMessage(ViewerMessageTypes.Clear));

    public Task<bool> ExitAsync() =>
        TrySendAsync(new ViewerMessage(ViewerMessageTypes.Exit));

    public Task<bool> SendAsync(string type, string? message = null, Dictionary<string, string>? args = null) =>
        TrySendAsync(new ViewerMessage(type, message, args));

    private async Task<bool> TrySendAsync(ViewerMessage msg)
    {
        if (_closed || _writer is null)
            return false;

        await _sendLock.WaitAsync();

        try
        {
            if (_closed || _writer is null)
                return false;

            string json = JsonSerializer.Serialize(msg);
            await _writer.WriteLineAsync(json);
            return true;
        }
        catch (IOException)
        {
            MarkClosed();
            return false;
        }
        catch (ObjectDisposedException)
        {
            MarkClosed();
            return false;
        }
        catch (InvalidOperationException)
        {
            MarkClosed();
            return false;
        }
        finally
        {
            _sendLock.Release();
        }
    }

    private async Task ReadLoopAsync()
    {
        try
        {
            if (_reader is null)
                return;

            while (!_closed && !(_cts?.IsCancellationRequested ?? false))
            {
                string? json = await _reader.ReadLineAsync();

                if (json is null)
                    break;

                var msg = JsonSerializer.Deserialize<ViewerMessage>(json);
                if (msg is null)
                    continue;

                MessageReceived?.Invoke(msg);

                if (msg.Type == ViewerMessageTypes.Input && msg.Message is not null)
                {
                    _inputChannel.Writer.TryWrite(msg.Message);
                    InputReceived?.Invoke(msg.Message);
                }
            }
        }
        catch (IOException)
        {
        }
        catch (ObjectDisposedException)
        {
        }
        catch (OperationCanceledException)
        {
        }
        finally
        {
            MarkClosed();
        }
    }

    public async Task<string?> ReadLineAsync(CancellationToken ct = default)
    {
        try
        {
            return await _inputChannel.Reader.ReadAsync(ct);
        }
        catch (ChannelClosedException)
        {
            return null;
        }
    }

    public async Task<string?> PromptAsync(string prompt = "> ", CancellationToken ct = default)
    {
        bool sent = await WriteAsync(prompt);

        if (!sent)
            return null;

        return await ReadLineAsync(ct);
    }

    public Task<bool> WriteProgressAsync(string text, bool clearToEndOfLine = true)
    {
        string value = clearToEndOfLine
            ? "\r" + text + "\u001b[K"
            : "\r" + text;

        return WriteAsync(value);
    }

    private void MarkClosed()
    {
        if (_closed)
            return;

        _closed = true;

        try { _cts?.Cancel(); } catch { }

        _inputChannel.Writer.TryComplete();

        try { _writer?.Dispose(); } catch { }
        try { _reader?.Dispose(); } catch { }
        try { _pipe?.Dispose(); } catch { }

        Closed?.Invoke();
    }

    public async ValueTask DisposeAsync()
    {
        if (!_closed)
            await ExitAsync();

        MarkClosed();

        if (_readLoopTask is not null)
        {
            try { await _readLoopTask; }
            catch { }
        }

        if (_process is { HasExited: false })
        {
            try { _process.Kill(); }
            catch { }
        }

        _cts?.Dispose();
        _sendLock.Dispose();
    }

    public static async Task RunTestAsync()
    {
        await using var viewer = new ConsoleViewerClient();

        /*viewer.InputReceived += input =>
        {
            Console.WriteLine($"Viewer typed: {input}");
        };*/

        await viewer.StartAsync(DefaultEnvPath);

        await viewer.WriteLineAsync("Viewer started.");
        await viewer.WriteAsync("Partial ");
        await viewer.WriteAsync("write ");
        await viewer.WriteLineAsync("works.");

        string? input = await viewer.PromptAsync();
        Console.WriteLine("Input was: " + input);

        for (int i = 0; i <= 100; i++)
        {
            await viewer.WriteProgressAsync($"Progress: {i}%");
            await Task.Delay(10);
        }

        await viewer.WriteLineAsync();

        Console.WriteLine("Main console is still available.");
        Console.WriteLine("Type anything and it will be printed. Type exit to close viewer.");

        while (true)
        {
            string? cmd = Console.ReadLine();
            if (cmd == "exit")
                break;

            await viewer.WriteLineAsync($"Main said: {cmd}");
        }
    }
}
