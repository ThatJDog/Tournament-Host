using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO.Pipes;
using System.Threading.Channels;
using TournamentHost.WebServices;

namespace TournamentHost;

internal class Program
{
    const bool CRTRL_C_EXIT = true; // messes up console otherwise as it submits the read line.

    private static readonly Channel<LogEvent> LogBus = Channel.CreateUnbounded<LogEvent>();
    private static readonly List<Process> ViewerProcesses = new();

    static async Task Main(string[] args)
    {
        bool debug = args.Contains("--debug") || true;
        bool viewer = args.Contains("--viewer");

        string pipeName = GetArg(args, "--pipe") ?? $"TournamentHostLogs-{Environment.ProcessId}";

        if (viewer)
        {
            await RunViewerAsync(pipeName);
            return;
        }

        using var shutdown = new CancellationTokenSource();

        Console.CancelKeyPress += (s, e) =>
        {
            // Always cancel to stop default handling.
            e.Cancel = true;

            if (CRTRL_C_EXIT)
            {
                MainInfo("Ctrl+C received. Shutting down...");
                shutdown.Cancel();
            }
        };

        MainInfo("Configuring HTTP server...");

        var logPipeServer = new LogPipeServer(pipeName);
        var pipeTask = logPipeServer.RunAsync(shutdown.Token);
        var broadcastTask = BroadcastLogsAsync(logPipeServer, shutdown.Token);

        var builder = WebApplication.CreateBuilder(args);

        // This disables ASP.NET Core's built-in Ctrl+C handling
        builder.Services.AddSingleton<IHostLifetime, NoConsoleLifetime>();

        builder.Logging.ClearProviders();
        builder.Logging.AddProvider(new ChannelLoggerProvider(LogBus));

        builder.WebHost.UseUrls("http://localhost:5000");

        var app = builder.Build();

        app.UseDefaultFiles();
        app.UseStaticFiles();

        app.Use(async (ctx, next) =>
        {
            Log("HTTP", $"{ctx.Request.Method} {ctx.Request.Path}");
            await next();
        });

        app.MapGet("/api/project", () =>
        {
            Log("API", "LoadProject called");
            return LoadProject();
        });

        app.MapPost("/api/save", (Project p) =>
        {
            Log("API", "SaveProject called");
            SaveProject(p);
            return Results.Ok();
        });

        app.MapPost("/api/command/{cmd}", (string cmd) =>
        {
            Log("COMMAND", $"Received: {cmd}");

            return cmd switch
            {
                "ping" => Results.Ok("pong"),
                _ => Results.Ok("unknown command")
            };
        });

        await app.StartAsync(shutdown.Token);

        MainInfo("Server started: http://localhost:5000");
        Log("SYSTEM", debug ? "Server started (DEBUG)" : "Server started");

        if (debug)
        {
            LaunchViewer(pipeName);
        }

        MainInfo("Type 'exit' to shut everything down.");

        var commandTask = RunMainConsoleAsync(shutdown);

        // await Task.WhenAny(commandTask, WaitForShutdownAsync(shutdown.Token));
        await commandTask;

        MainInfo("Stopping server...");
        Log("SYSTEM", "Shutdown requested");

        await app.StopAsync();
        await app.DisposeAsync();

        shutdown.Cancel();

        LogBus.Writer.TryComplete();

        logPipeServer.Dispose();

        CloseViewers();

        MainInfo("Exited cleanly.");
    }

    static Task WaitForShutdownAsync(CancellationToken token)
    {
        var tcs = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);

        token.Register(() => tcs.TrySetResult());

        return tcs.Task;
    }

    // =======================================================
    // MAIN CONSOLE
    // =======================================================

    static async Task RunMainConsoleAsync(CancellationTokenSource shutdown)
    {
        while (!shutdown.IsCancellationRequested)
        {
            Console.Write("> ");

            var readTask = Task.Run(Console.ReadLine);
            var cancelTask = WaitForShutdownAsync(shutdown.Token);

            var completed = await Task.WhenAny(readTask, cancelTask);

            if (completed == cancelTask)
                return;

            string? input = await readTask;

            if (string.IsNullOrWhiteSpace(input))
                continue;

            string command = input.Trim();

            switch (command.ToLowerInvariant())
            {
                case "exit":
                    shutdown.Cancel();
                    return;

                case "browser":
                    OpenBrowser("http://localhost:5000");
                    break;

                default:
                    MainInfo($"Unknown command: {command}");
                    break;
            }
        }
    }

    static void MainInfo(string message)
    {
        Console.WriteLine($"[MAIN] {message}");
    }

    // =======================================================
    // LOGGING
    // =======================================================

    static void Log(string category, string message)
    {
        LogBus.Writer.TryWrite(new LogEvent(category, message));
    }

    static async Task BroadcastLogsAsync(LogPipeServer pipeServer, CancellationToken token)
    {
        try
        {
            await foreach (var log in LogBus.Reader.ReadAllAsync(token))
            {
                string line = $"[{log.Category}] {log.Message}";
                await pipeServer.BroadcastAsync(line);
            }
        }
        catch (OperationCanceledException)
        {
        }
    }

    // =======================================================
    // DEBUG VIEWER PROCESS
    // =======================================================

    static async Task RunViewerAsync(string pipeName)
    {
        Console.Title = "TournamentHost Debug Viewer";
        Console.WriteLine("Debug viewer started. Waiting for server logs...\n");

        try
        {
            using var pipe = new NamedPipeClientStream(
                ".",
                pipeName,
                PipeDirection.In,
                PipeOptions.Asynchronous);

            await pipe.ConnectAsync();

            using var reader = new StreamReader(pipe);

            while (await reader.ReadLineAsync() is { } line)
            {
                Console.WriteLine(line);
            }
        }
        catch
        {
            Console.WriteLine("\nViewer disconnected.");
        }
    }

    static void LaunchViewer(string pipeName)
    {
        try
        {
            var exe = Process.GetCurrentProcess().MainModule!.FileName!;

            var process = Process.Start(new ProcessStartInfo
            {
                FileName = exe,
                Arguments = $"--viewer --pipe \"{pipeName}\"",
                UseShellExecute = true
            });

            if (process is not null)
            {
                ViewerProcesses.Add(process);
                MainInfo("Debug viewer launched.");
            }
        }
        catch
        {
            MainInfo("Failed to launch debug viewer.");
        }
    }

    static void CloseViewers()
    {
        foreach (var viewer in ViewerProcesses)
        {
            try
            {
                if (!viewer.HasExited)
                    viewer.Kill(entireProcessTree: true);
            }
            catch
            {
            }
        }
    }

    // =======================================================
    // DOMAIN LOGIC
    // =======================================================

    static Project LoadProject() => new();

    static void SaveProject(Project p)
    {
    }

    // =======================================================
    // UTIL
    // =======================================================

    static void OpenBrowser(string url)
    {
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = url,
                UseShellExecute = true
            });

            MainInfo("Browser opened.");
        }
        catch
        {
            MainInfo("Failed to open browser.");
        }
    }

    static string? GetArg(string[] args, string name)
    {
        int index = Array.IndexOf(args, name);
        return index >= 0 && index + 1 < args.Length
            ? args[index + 1]
            : null;
    }
}

// =======================================================
// NAMED PIPE LOG SERVER
// =======================================================

sealed class LogPipeServer : IDisposable
{
    private readonly string _pipeName;
    private readonly ConcurrentDictionary<int, StreamWriter> _clients = new();
    private int _nextClientId;
    private bool _disposed;

    public LogPipeServer(string pipeName)
    {
        _pipeName = pipeName;
    }

    public async Task RunAsync(CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            var pipe = new NamedPipeServerStream(
                _pipeName,
                PipeDirection.Out,
                NamedPipeServerStream.MaxAllowedServerInstances,
                PipeTransmissionMode.Byte,
                PipeOptions.Asynchronous);

            try
            {
                await pipe.WaitForConnectionAsync(token);

                int clientId = Interlocked.Increment(ref _nextClientId);

                var writer = new StreamWriter(pipe)
                {
                    AutoFlush = true
                };

                _clients[clientId] = writer;
            }
            catch
            {
                await pipe.DisposeAsync();
            }
        }
    }

    public async Task BroadcastAsync(string line)
    {
        foreach (var (clientId, writer) in _clients)
        {
            try
            {
                await writer.WriteLineAsync(line);
            }
            catch
            {
                if (_clients.TryRemove(clientId, out var removed))
                    await removed.DisposeAsync();
            }
        }
    }

    public void Dispose()
    {
        if (_disposed)
            return;

        _disposed = true;

        foreach (var (_, writer) in _clients)
        {
            try
            {
                writer.Dispose();
            }
            catch
            {
            }
        }

        _clients.Clear();
    }
}

// =======================================================
// ASP.NET LOGGER → LOG BUS
// =======================================================

sealed class ChannelLoggerProvider : ILoggerProvider
{
    private readonly Channel<LogEvent> _channel;

    public ChannelLoggerProvider(Channel<LogEvent> channel)
    {
        _channel = channel;
    }

    public ILogger CreateLogger(string categoryName)
        => new ChannelLogger(categoryName, _channel);

    public void Dispose()
    {
    }

    private sealed class ChannelLogger : ILogger
    {
        private readonly string _category;
        private readonly Channel<LogEvent> _channel;

        public ChannelLogger(string category, Channel<LogEvent> channel)
        {
            _category = category;
            _channel = channel;
        }

        public IDisposable? BeginScope<TState>(TState state)
            where TState : notnull
            => null;

        public bool IsEnabled(LogLevel logLevel)
            => logLevel >= LogLevel.Information;

        public void Log<TState>(
            LogLevel logLevel,
            EventId eventId,
            TState state,
            Exception? exception,
            Func<TState, Exception?, string> formatter)
        {
            string message = formatter(state, exception);

            _channel.Writer.TryWrite(
                new LogEvent("SERVER", $"{logLevel}: {_category}: {message}")
            );
        }
    }
}

// =======================================================
// DATA MODEL
// =======================================================

class Project
{
}

record LogEvent(string Category, string Message);