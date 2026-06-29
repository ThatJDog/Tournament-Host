using Microsoft.EntityFrameworkCore.Metadata.Internal;

namespace MediaHub.WebServices;

public sealed class WebServerOptions
{
    // TODO It would be better if my Current Web Server class just applied
    // default configuration to a given web server but for now a small API is fine.

    public string Url { get; set; } = "http://localhost:5000";

    public readonly List<Action<WebApplication>> ApplicationHooks = new();
    public readonly List<ServerCommand> CommandRegistrations = new();
    public readonly List<View> Views = [];

    public void AddAppHook(Action<WebApplication> mapPages)
        => ApplicationHooks.Add(mapPages);

    public void AddCommand(ServerCommand mapCommands)
        => CommandRegistrations.Add(mapCommands);


    public void RegisterView(View view)
        => Views.Add(view);

    internal void RegisterViews(List<View> views)
        => Views.AddRange(views);
}