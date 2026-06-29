namespace MediaHub.WebServices;

public enum RequestMethod
{
    GET,
    POST,
    PUT,
    DELETE,
    PATCH,
    HEAD,
    OPTIONS
}

public abstract class View
{
    public abstract string Route { get; }

    public virtual RequestMethod Method => RequestMethod.GET;

    public abstract Task<IResult> HandleAsync(
        HttpContext context,
        CancellationToken ct);
}

public abstract class HtmlView : View
{
    protected abstract string Render(HttpContext context);

    public override async Task<IResult> HandleAsync(
        HttpContext context,
        CancellationToken ct)
    {
        await Task.CompletedTask;

        return Results.Content(
            Render(context),
            "text/html");
    }
}

public abstract class HtmlViewAsync : View
{
    protected abstract Task<string> RenderAsync(HttpContext context);

    public override async Task<IResult> HandleAsync(
        HttpContext context,
        CancellationToken ct)
    {
        await Task.CompletedTask;

        return Results.Content(
            await RenderAsync(context),
            "text/html");
    }
}