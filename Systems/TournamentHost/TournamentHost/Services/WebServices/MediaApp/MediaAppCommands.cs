namespace MediaHub.WebServices.MediaApp;

internal static class MediaAppCommands
{
    public static void Register(WebApplication app)
    {
        app.MapPost("/api/command/reload", () =>
        {
            return Results.Ok("reload complete");
        });
    }
}