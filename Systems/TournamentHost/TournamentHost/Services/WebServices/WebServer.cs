using MediaHub.WebServices;
using System.Diagnostics;

public interface IServerViewer : IAsyncDisposable
{
    bool IsClosed { get; }
    bool AllowsInput { get; }

    Task StartAsync(CancellationToken ct = default);
    Task WriteLineAsync(string text = "", CancellationToken ct = default);
    Task<string?> PromptAsync(CancellationToken ct = default);
    Task ClearAsync(CancellationToken ct = default);
}

public interface IViewerFactory
{
    Task<IServerViewer> CreateAsync(string title, CancellationToken ct = default);
}

public enum ServerRunMode
{
    Blocking,
    Background
}

internal class Project
{
    public Project()
    {
    }
}

public sealed class WebServer : IAsyncDisposable
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly IViewerFactory _viewerFactory;
    private readonly List<IServerViewer> _viewers = new();
    private readonly List<IServerViewer> _debugViewers = new();

    private readonly List<ServerCommand> _commands = [];

    private WebApplication? _app;
    private CancellationTokenSource? _cts;
    private Task? _commandLoopTask;
    private ViewerLoggerProvider? _loggerProvider;
    private IServerViewer? _controlViewer;

    public bool IsRunning => _app is not null;

    private readonly WebServerOptions _options;

    public WebServer(IViewerFactory viewerFactory, WebServerOptions? options = null)
    {
        _viewerFactory = viewerFactory;
        _options = options ?? new WebServerOptions();
    }

    public async Task StartAsync(
        bool debug = false,
        bool commandLoop = true,
        CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct);
        try
        {
            if (_app is not null)
                return;

            _cts = CancellationTokenSource.CreateLinkedTokenSource(ct);

            _controlViewer = await _viewerFactory.CreateAsync(
                "Server Lifecycle Viewer",
                _cts.Token);
            await _controlViewer.StartAsync(ct);

            _viewers.Add(_controlViewer);
            await _controlViewer.WriteLineAsync("Server Lifecycle Viewer\n", ct);

            if (debug)
            {
                var debugViewer = await _viewerFactory.CreateAsync(
                    "Network Debug Viewer",
                    _cts.Token);
                await debugViewer.StartAsync(ct);

                _debugViewers.Add(debugViewer);
                _viewers.Add(debugViewer);

                await debugViewer.WriteLineAsync("Network Debug Viewer\n", ct);
            }

            _loggerProvider = new ViewerLoggerProvider(_debugViewers);

            var builder = WebApplication.CreateBuilder();

            builder.Services.AddSingleton<IHostLifetime, NoConsoleLifetime>();

            builder.Logging.ClearProviders();
            builder.Logging.AddProvider(_loggerProvider);

            builder.WebHost.UseUrls(_options.Url);

            var app = builder.Build();

            app.UseDefaultFiles();
            app.UseStaticFiles();

            app.Use(async (ctx, next) =>
            {
                await WriteAllAsync($"[HTTP] {ctx.Request.Method} {ctx.Request.Path}");
                await next();
            });

            RegisterBuiltInCommands();

            // OPTIONS
            foreach (var registerPages in _options.ApplicationHooks)
                registerPages(app);

            _commands.AddRange(_options.CommandRegistrations);

            MapViews(app, _options.Views);

            // FINISHED SETUP

            _app = app;

            await _app.StartAsync(_cts.Token);

            await WriteAllAsync("[SYSTEM] Server started: http://localhost:5000");

            if (commandLoop)
                _commandLoopTask = Task.Run(() => RunCommandLoopAsync(_cts.Token));
        }
        catch
        {
            await CleanupAsync();
            throw;
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task RunBlockingAsync(
        bool debug = false,
        bool commandLoop = true,
        CancellationToken ct = default)
    {
        await StartAsync(debug, commandLoop, ct);

        try
        {
            if (_app is not null)
                await _app.WaitForShutdownAsync(ct);
        }
        finally
        {
            await StopAsync();
        }
    }

    public async Task StopAsync()
    {
        await _gate.WaitAsync();
        try
        {
            if (_app is null)
                return;

            await WriteAllAsync("[SYSTEM] Stopping server...");

            _cts?.Cancel();

            await _app.StopAsync();
            await _app.DisposeAsync();

            _app = null;

            await WriteAllAsync("[SYSTEM] Server exited cleanly.");

            await CleanupAsync();
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task RestartAsync(bool debug = false, bool commandLoop = true)
    {
        await StopAsync();
        await StartAsync(debug, commandLoop);
    }

    private async Task RunCommandLoopAsync(CancellationToken ct)
    {
        if (_controlViewer is null)
            return;

        while (!ct.IsCancellationRequested)
        {
            string? input;

            if (_controlViewer.AllowsInput)
            {
                try
                {
                    input = await _controlViewer.PromptAsync(ct);
                }
                catch (OperationCanceledException)
                {
                    return;
                }
            }
            else
            {
                Thread.Sleep(1000); // to prevent cpu throttling
                input = null;
            }

            if (string.IsNullOrWhiteSpace(input))
                continue;

            var command = _commands.FirstOrDefault(x => x.Matches(input));

            if (command is null)
            {
                await _controlViewer.WriteLineAsync(
                    $"Unknown command: {input}",
                    ct);

                continue;
            }

            await command.ExecuteAsync(ct);

            if (command.Name is "exit" or "restart")
                return;
        }
    }

    /*private async Task RunCommandLoopAsync(CancellationToken ct)
    {
        if (_controlViewer is null)
            return;

        while (!ct.IsCancellationRequested)
        {
            string? input;

            try
            {
                input = await _controlViewer.PromptAsync(ct);
            }
            catch (OperationCanceledException)
            {
                return;
            }

            if (string.IsNullOrWhiteSpace(input))
                continue;

            switch (input.Trim().ToLowerInvariant())
            {
                case "exit":
                case "stop":
                    _ = Task.Run(StopAsync);
                    return;

                case "restart":
                    _ = Task.Run(() => RestartAsync());
                    return;

                case "browser":
                    OpenBrowser("http://localhost:5000");
                    break;

                case "clear-viewers":
                    foreach (var viewer in _viewers)
                        await viewer.ClearAsync(ct);
                    break;

                default:
                    await _controlViewer.WriteLineAsync($"Unknown command: {input}", ct);
                    break;
            }
        }
    }*/

    private void RegisterBuiltInCommands()
    {
        _commands.Add(new ServerCommand
        {
            Name = "exit",
            Aliases = ["stop"],
            Description = "Stops the server",
            ExecuteAsync = async _ =>
            {
                var t = Task.Run(StopAsync);
                await Task.CompletedTask;
            }
        });

        /*_commands.Add(new ServerCommand
        {
            Name = "restart",
            Description = "Restarts the server",
            ExecuteAsync = async _ =>
            {
                // TODO doesnt use current debug/commandLoop settings
                var t = Task.Run(() => RestartAsync());
                await Task.CompletedTask;
            }
        });*/

        _commands.Add(new ServerCommand
        {
            Name = "browser",
            Description = "Opens browser",
            ExecuteAsync = async _ =>
            {
                OpenBrowser("http://localhost:5000");
                await Task.CompletedTask;
            }
        });

        _commands.Add(new ServerCommand
        {
            Name = "clear-viewers",
            Description = "Clears all viewers",
            ExecuteAsync = async ct =>
            {
                foreach (var viewer in _viewers)
                    await viewer.ClearAsync(ct);
            }
        });
    }

    private void MapViews(WebApplication app, List<View> views)
    {
        foreach (var view in views)
        {
            switch (view.Method)
            {
                case RequestMethod.GET:
                    app.MapGet(view.Route,
                        (HttpContext ctx, CancellationToken ct)
                            => view.HandleAsync(ctx, ct));
                    break;

                case RequestMethod.POST:
                    app.MapPost(view.Route,
                        (HttpContext ctx, CancellationToken ct)
                            => view.HandleAsync(ctx, ct));
                    break;

                case RequestMethod.PUT:
                    app.MapPut(view.Route,
                        (HttpContext ctx, CancellationToken ct)
                            => view.HandleAsync(ctx, ct));
                    break;

                case RequestMethod.DELETE:
                    app.MapDelete(view.Route,
                        (HttpContext ctx, CancellationToken ct)
                            => view.HandleAsync(ctx, ct));
                    break;

                default:
                    throw new NotSupportedException($"Unsupported HTTP method: {view.Method}");
            }
        }
    }

    private async Task WriteAllAsync(string text = "")
    {
        foreach (var viewer in _debugViewers.ToArray())
        {
            if (!viewer.IsClosed)
                await viewer.WriteLineAsync(text);
        }
    }

    private async Task CleanupAsync()
    {
        _cts?.Dispose();
        _cts = null;

        _loggerProvider?.Dispose();
        _loggerProvider = null;

        if (_commandLoopTask is not null)
        {
            try { await _commandLoopTask; }
            catch (OperationCanceledException) { }

            _commandLoopTask = null;
        }

        foreach (var viewer in _viewers)
            await viewer.DisposeAsync();

        _viewers.Clear();
        _debugViewers.Clear();
        _controlViewer = null;
    }

    private static void OpenBrowser(string url)
    {
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = url,
                UseShellExecute = true
            });
        }
        catch
        {
            // optionally log to viewer
        }
    }

    public async ValueTask DisposeAsync()
    {
        await StopAsync();
        _gate.Dispose();
    }
}