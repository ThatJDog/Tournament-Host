using MediaHub.MediaAppData.SqlLite;
using Microsoft.EntityFrameworkCore;
using System.Text;

namespace MediaHub.WebServices.MediaApp.DatabaseViews;

public class DatabaseHomeView : AbstractDatabaseView
{
    public DatabaseHomeView(IDbContextFactory<MediaHubDbContext> dbFactory)
        : base(dbFactory)
    {
    }

    public override string Route => DatabaseDebugRoutes.Home;

    protected override async Task<string> RenderAsync(HttpContext context)
    {
        return await RenderDatabaseHomeAsync(context.RequestAborted);
    }

    protected async Task<string> RenderDatabaseHomeAsync(CancellationToken ct)
    {
        try
        {
            List<string> tables = await GetTableNamesAsync(ct);

            StringBuilder html = new();

            html.Append(RenderPageStart("Database Viewer"));

            html.Append("""
<h1>Database Viewer</h1>

<p>
    <a href="/debug/db/query">Run SQL Query</a>
</p>

<h2>Tables</h2>
<ul>
""");

            foreach (string table in tables)
            {
                html.Append($"""
<li><a href="{Html(DatabaseDebugRoutes.TableUrl(table))}">{Html(table)}</a></li>
""");
            }

            html.Append("""
</ul>

<h2>Table Previews</h2>
""");

            foreach (string table in tables)
            {
                string sql = $"""
SELECT *
FROM "{EscapeIdentifier(table)}"
LIMIT 10
""";

                html.Append($"""
<h3>
    <a href="{Html(DatabaseDebugRoutes.TableUrl(table))}">{Html(table)}</a>
</h3>
""");

                html.Append(await RenderQueryTableFragmentAsync(sql, ct));
            }

            html.Append(RenderPageEnd());

            return html.ToString();
        }
        catch (Exception ex)
        {
            return RenderErrorPage("Database home", ex);
        }
    }
}